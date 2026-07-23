# From 0.1 to 2.0: rebuilding a fuzzy-search library (and catching my own benchmarks lying)

> **Draft stub.** Structure + decisions as bullets. Flesh out prose, add code samples,
> pick a voice. Working title — swap for something punchier.

**Hook:** I opened a `KNOWN-ISSUES.md` to fix "a few bugs" in my ~2 kB fuzzy-search
library. I came out the other side with a breaking v1.0, a new build toolchain, a
benchmark suite, a rename (it's now **`Krino`**), and a two-hour brawl with npm's 2FA.
Then came a *second* pass — where I caught my own benchmarks lying, verified every
comparison against the competitors' source, and landed a real ~2× speedup. And a
*third* — the index got ~5× faster to build by deleting a data structure, queries
learned that typing is a sequence, and two config knobs deleted themselves. By the
end the benchmark harness had become a product of its own: frozen corpora, a
thirteen-probe test set scored like an IR system, Pareto charts with two ledgers —
and it kept catching *itself* lying, right up to a config that benchmarked faster
than its own identical twin. Here's every decision along the way: the engineering
*and* the war stories.

---

# Part I — 0.1 → 1.0

## 0. The origin: a comma broke the matcher

- Krino started as `@mmmike/mikrofuzz`, a fork-in-spirit of
  [@nozbe/microfuzz](https://github.com/Nozbe/microfuzz). The forcing function was
  real: wiring fuzzy search into a blog — short curated fields searched fuzzily, a
  multi-KB body-vocabulary field searched contains-only.
- That integration surfaced six bugs (`KNOWN-ISSUES.md`), the worst being that a
  **single comma demoted a strong multi-word match into the junk-fuzzy tier** —
  `"build,"` never equalled `"build"` because punctuation wasn't a word boundary.
  Real prose broke the matcher. That's the itch behind everything below.

## 1. Start with the failing state, not the fix

- The repo had a `KNOWN-ISSUES.md`: 4 documented bugs, 1 "hazard," 5 feature requests —
  each with an executable repro in `known-issues.test.ts`.
- **The clever bit already there:** the tracker used a convention — passing `it()` pins
  *current (wrong)* behaviour, `it.fails()` pins *desired* behaviour. The suite stays
  green while bugs exist; a fix flips `it.fails` to "unexpected pass," forcing cleanup.
- **Decision: write the test suite *before* fixing anything.** Coverage was one file.
  Nothing tested `createFuzzySearch`, normalization, strategies, or the scoring tiers.

## 2. Tests that survive their own fix

- **Core constraint:** the main suite had to pass *now* AND still pass *after* the known
  bugs got fixed — pinning buggy behaviour is the tracker's job, not the suite's.
- Concretely: avoid punctuation-adjacent cases (bug 1), avoid first-occurrence-mid-word
  cases (bug 2/3), assert multi-word as a *tier band* not an exact score (bug 4 would
  change it).
- Writing the tests surfaced **two new bugs** nobody had logged:
  - `fuzzyMatch(text, "")` returned a bogus `0.5` match (the empty-query guard only
    existed in `createFuzzySearch`).
  - Highlight width used the raw query length against normalized-text indices, so a
    padded query over-widened the range.
- Result: 77 passing + 7 expected-fail. Committed tests *first*, on their own branch.
- **Takeaway:** writing tests is the cheapest bug-finder you have. Two of the six bugs
  came from *writing the tests*, not from the issue tracker.

## 3. Splitting the monolith — and a lesson about "shared"

- `index.ts` was 283 lines mixing five concerns. Split into `shared` / `fuzzy` / `match`
  / `search` + a barrel.
- Wrote a `docs/naming.md` audit — every noun/verb, 15 naming inconsistencies flagged
  (e.g. `item` meant both a field-string and a collection element).
- **The lesson:** I initially put the score constants in `shared.ts` as "shared scoring
  vocabulary." Wrong — the tier scores were used *only* by `match.ts`, the chunk scores
  *only* by `fuzzy.ts`. Nothing was actually shared across files.
  - **"Shared" code isn't shared until two or more consumers actually use it.** Localize
    until proven otherwise.
- Enabled tree-shaking properly: added `"sideEffects": false` (the code was already
  side-effect-free; the flag makes bundlers trust it).

## 4. Look at the field before you design

- Before deciding *how* to fix the scoring bugs, researched the incumbents: **match-sorter**
  (the closest twin — an explicit tier ladder), **uFuzzy** (fast, primitive-first),
  **fzf** (bonus-based scoring), **Fuse.js** (Bitap edit-distance, typo-tolerant).
- Findings that shaped decisions:
  - **Punctuation as a word boundary** is standard — uFuzzy's default `interSplit` is
    `[^A-Za-z\d']+`; fzf treats any non-alphanumeric before an alphanumeric as a boundary.
  - **No library penalizes matching more query words.** mikrofuzz's `1.5 + 0.2·n` (more
    words = worse rank) was a genuine defect, not a preference.
  - **uFuzzy exposes raw signals and lets you `Array.sort` yourself** rather than baking a
    black-box score — a philosophy, not just an implementation detail.
- **Takeaway:** "how does the field solve this" is a 30-minute investment that changes
  what you build.

## 5. Catching myself kitchen-sinking the API

- After the research I started *adding*: per-field config, an `acronym` tier, per-field
  `scores`, a `matchDensity` helper, exported tier constants… one per iteration.
- **The gut-check:** "are we overloading the API?" Yes. Each addition was individually
  justifiable; collectively they doubled the surface of a library whose whole pitch was
  "tiny + does one thing."
- **The reframe (borrowed from uFuzzy):** don't grow options — **expose a primitive and
  compose.** The real atom is *"score one string → { score, tier, ranges }"*; everything
  else (collections, multi-field, penalties, ranking) is composition on top.
- **Takeaway:** every exported symbol is a permanent cost. "It works and it's tested"
  ≠ "it should ship." Restraint is a feature for a small library.

## 6. The v1.0 API: primitive-first

- **Considered and rejected:** a fluent builder (stateful, poor tree-shaking, ambiguous
  per-field binding) and a class-with-strategies (kills tree-shaking, `new`/`this`
  ceremony for a tiny config). Went **functional / data-first** — the shape that fits a
  2 kB lib.
- Final shape:
  - `fuzzyMatch(text, query, { strategy?, acronym? }) → { score, tier, ranges } | null`
    — the primitive.
  - `createFuzzySearch(list, getText? | FieldSpec[])` — three typed overloads, **no
    options bag, `key` removed**. Its real job is the preprocessing cache (build once,
    query many).
- **Numbers vs. categories:** every match now carries a categorical `tier` (`"exact"` …
  `"fuzzy"`) *alongside* the numeric `score`. The number is the sort key; the tier says
  *what kind* of match it was (a single float can't reliably do both once penalties/fuzzy
  blur the ranges).
- **`atBest` over `rank`:** a per-field demote-only offset covers the real use case
  ("body never outranks title") in one number; a general `rank` merge function was YAGNI
  (deferred to v1.1). `atBest ⊂ rank`.
- **What got cut:** the `key` option, custom-matcher `strategy` functions (leaked internal
  contracts), a top-level `rank`. Result shape consolidated: parallel `matches[]` + `scores[]`
  → one `fields[]` of `{ score, tier, ranges }`.

## 7. A cheap 2× — one regex gate

- The benchmark's slow path was the fuzzy fallback running its hand-rolled character loop
  on *every* non-matching item.
- **The fix (an uFuzzy lesson applied surgically):** both fuzzy strategies require the
  query to be a subsequence of the field. So build one lazy-subsequence regex per query
  (`t[^]*k[^]*n…`) and `test()` each field in *native* code before the JS loop.
  Behaviour-identical — it only rejects fields that couldn't match anyway.
- **Result: ~2× query throughput** (559 → 909 → 1017 hz across the session), with zero
  test changes.
- **Takeaway:** don't rewrite the engine to chase a faster competitor. Find the one hot
  path and hand it to the platform (here, the regex engine).

## 8. Benchmarks and honest positioning

- Built a cross-lib benchmark (same dataset, same queries, non-typo task) vs match-sorter,
  uFuzzy, Fuse.js.
- **Honest results:** mikrofuzz is mid-pack on speed — ~2.7× faster than match-sorter,
  ~14× faster than Fuse, but ~3–4× *behind* uFuzzy (which matches entirely via native
  regex; that gap is architectural). Smallest bundle by a wide margin (2.4 kB gzip vs
  4.1 / 8.7 / 12.8), zero deps.
- **Fairness caveats matter:** Fuse is "slower" because it does *typo tolerance* the others
  don't — comparing raw ms is apples-to-oranges. State the caveat, don't spin the number.
- **A representation bug:** the first speed table used "% faster/slower vs mikrofuzz." But
  "% slower" caps at −100%, so Fuse (14× slower) read as `−93%` — indistinguishable from
  match-sorter's `−62%`.
  - **Fix:** relative *time* with mikrofuzz = 100% (lower = faster). uFuzzy ≈ 25%, Fuse ≈
    1400%. The magnitude finally shows.
  - **Takeaway:** a capped delta hides magnitude; a ratio to a fixed baseline doesn't.
- *Foreshadow:* this table was still quietly dishonest — mixed measurement methods and
  an overclaim or two. Part II (§13–15) tears it down and rebuilds it.

## 9. When the build broke itself: TS7 → tsdown

- A TypeScript 7 bump broke `pnpm build`: `unbuild` generates `.d.ts` via
  **rollup-plugin-dts**, which drives the TS *compiler API* — and that plugin is in
  maintenance mode and doesn't support TS7.
- **The real diagnosis:** the disease isn't "TS7," it's *coupling `.d.ts` generation to
  the TypeScript compiler version.* It'll break again on the next TS shift.
- **Considered Vite** (library mode) — rejected: its `vite-plugin-dts` reintroduces the
  same TS-compiler coupling, and Vite is app-shaped overkill for a library.
- **Chose tsdown** (Rolldown + oxc): with `isolatedDeclarations`, oxc emits `.d.ts` from
  *syntax*, no TS compiler API. **The build is now independent of the TS version** — and
  faster (~55 ms), and the bundle got *smaller* (comments stripped).
  - Bonus guardrail: `isolatedDeclarations` forces every export to have an explicit type,
    or typecheck fails — good hygiene for a public API.
- **Takeaway:** decouple your build from your compiler. If a d.ts tool needs the TS API,
  it inherits every TS breaking change.

## 10. Packaging polish

- Hardened `package.json`: `CHANGELOG.md` + `MIGRATION.md` added to `files` (npm doesn't
  auto-include them), `publishConfig.access: public` (scoped packages default to
  restricted), `prepublishOnly` gates publish on `lint:types && test && build`.
- Wrote a concise `MIGRATION.md` (0.x → 1.0 before/after) — small breaking surface, cheap
  to document, professional for a major bump.
- **Moved benchmarks to a workspace sub-package** so competitor deps (fuse.js /
  match-sorter / uFuzzy) stay *out of the published library's manifest*.
- Committed the whole thing as a small, honest set of commits (the source evolved in
  place, so a granular fix→feat split wasn't cleanly recoverable — 2–3 commits, not 5).

## 11. The npm publishing gauntlet

- Merged, tagged `v1.0.0`, pushed → CI publish workflow ran, built, signed provenance…
  then **`E404` on the registry `PUT`.**
- **Misleading error:** for a scoped package that already exists, npm returns 404 (not 403)
  on an auth failure — to hide package existence. So E404-on-publish ≈ **bad/expired token.**
- The deeper cause: **npm stopped allowing new TOTP 2FA enrollments** (security keys /
  passkeys only now). The automation-token flow was effectively dead.
- **The crucial clarification:** *"passkey" ≠ "hardware key."* A passkey is software —
  phone biometrics (Face/Touch ID, Windows Hello), or a password manager (KeePassXC,
  Bitwarden). No $50 YubiKey required. (Registering via a phone browser is the fewest
  steps.)
- **The actual fix: OIDC trusted publishing** (GA July 2025). GitHub Actions authenticates
  to npm via short-lived OIDC — **no token, no 2FA, no key in CI**, provenance automatic.
  One-time web config (repo + workflow filename), then every release is hands-off.
- Reworked the workflow (`id-token: write`, `npm ≥ 11.5.1`, no `NPM_TOKEN`), re-pointed the
  tag, pushed → **`@mmmike/mikrofuzz@1.0.0` published, token-less.**
- **Takeaways:**
  - npm's E404 on publish is almost always auth, not a missing package.
  - Don't confuse passkeys with hardware keys — the former are free and software-backed.
  - OIDC trusted publishing is the modern answer: remove long-lived tokens from CI entirely.

---

# Part II — after 1.0: the honesty pass and a real 2× win

> The library shipped. Then I actually *read* my own README and benchmark, and
> found both were quietly overselling. Fixing that honestly turned into the most
> useful engineering of the whole project — including a genuine speedup.

## 12. The rename: `@mmmike/mikrofuzz` → `Krino`

- Dropped the scope, picked a real name. **`Krino`**, from Ancient Greek κρίνω ("to
  sift, separate") — the root of *criterion*, *discern*, *critic*. A fuzzy matcher
  sifts a list and judges each candidate against a criterion. The name *is* the job.
- Mechanics: package name, repo / homepage / bugs URLs, keywords, the bench
  workspace, plus a migration note (old package deprecated in favour of `Krino`;
  swap the import, same 1.0 API).
- **Takeaway:** an unscoped, meaningful name is worth the churn *before* you have
  users. After, it's a migration.

## 13. My first benchmark table was (quietly) lying

- Reviewing the README before publishing, I caught my own overclaims:
  - *"the smallest option available"* — **false.** `fuzzy` (0.8 kB) and
    `@nozbe/microfuzz` (1.7 kB — the lib Krino forked) are both smaller.
  - *"handles escape characters"* — an **internal** regex-escape (so a `.` in a query
    stays literal) mistaken for a user feature. Invisible plumbing.
  - *"Levenshtein like Bitap"* — imprecise; Bitap ≠ Levenshtein.
- The size table also **mixed methods**: Krino's own artifact vs competitors' numbers
  lifted from bundlephobia. Re-measured **all eight** with one method —
  `esbuild --bundle --minify | gzip`, tree-shaken to each lib's primary API (the bytes
  a consumer's bundler actually adds). Numbers moved a lot (uFuzzy 8.7 → 4.1 kB, Fuse
  12.8 → 9.3).
- And the shipped bundle was **unminified** (2.4 kB) while I quoted the number a
  consumer sees. Fixed by actually minifying the ship so `npm pack` matches the tin.
- **Takeaway:** measure every row with one reproducible method. A favorable-but-
  inconsistent number is a liability — and your own README is the easiest place to
  fool yourself.

## 14. Speed is the wrong axis — a feature-first comparison (verified, not guessed)

- At Krino's target sizes — palettes, pickers, autocomplete over a few thousand items
  — **every non-typo library answers in well under a millisecond.** Speed doesn't
  decide; capability does.
- Rebuilt the comparison around a **capability matrix** (ranges / tier / diacritics /
  multi-word / per-field / typos) as the hero, and demoted the speed table into a
  collapsible.
- **Verify, don't guess:** a comparison table is a factual claim about *other people's
  software.* I verified **every cell against each library's actual source, types, and
  npm metadata** (fanned out to parallel agents, one per lib group). That corrected my
  own assumptions:
  - match-sorter has a tier but **no ranges and no multi-word.**
  - uFuzzy's typo tolerance is **opt-in, single-char.**
  - fast-fuzzy's "ranges" are **one span**, not per-character; it doesn't fold
    diacritics by default.
  - **"Maintained" is not a Krino edge** — Fuse and match-sorter both shipped in 2026.
- The honest position Krino can stand on: the only lib returning a categorical `tier`
  *and* numeric ranges, folding diacritics, matching multi-word, with per-field config
  — all default-on, no typo machinery.
- **Takeaway:** verify each cell of a comparison or don't publish it. And lead with the
  axis where your library actually wins.

## 15. The corpus was lying too — faker vs the word-grid

- The benchmark corpus was combinatorial (`ADJ × NOUN × SUFFIX`) → **heavy shared
  prefixes** → ideal conditions for **trie-based** libraries.
- Switched to a **seeded faker corpus** (product / company / person / place names) at
  1k / 10k / 100k.
- **fast-fuzzy flipped from ~4× *faster* than Krino to ~4–9× *slower*.** Its trie's
  whole advantage — pruning subtrees that share prefixes — evaporated on natural-
  language data.
- **Takeaway:** corpus shape drives benchmark numbers as much as the algorithm does.
  State your corpus; prefer natural-language data unless prefix-clustering is precisely
  what you mean to measure.

## 16. Why *is* uFuzzy so fast? (read the source)

- uFuzzy stayed ~5× ahead even after my optimizations. Instead of hand-waving, I read
  its source: **one compiled regex per needle** that filters all N candidates in the
  **native regex engine**, then ranks **only the survivors** — and it does less by
  default (no diacritics / tiers / multi-word). The gap is *architectural*, not
  incidental overhead I could gate away.
- (And fast-fuzzy's earlier "win" was a **trie + threshold pruning**, not "typo
  tolerance is cheap" — and entirely corpus-dependent, per §15.)
- **Takeaway:** when a competitor is faster, name the mechanism. "They're just faster"
  isn't a diagnosis.

## 17. The real win: borrow uFuzzy's filter — *safely*

- uFuzzy's lesson, applied to Krino: reject non-candidates with a **native regex at the
  front of the tier ladder**, before any per-item work runs.
- **The correctness trap:** uFuzzy's filter is a **subsequence** (in-order) regex. But
  Krino's multi-word tier matches words **out of order** — a subsequence gate would
  wrongly reject `"foo bar"` against `"bar … foo"`. So the front gate had to be
  **order-independent char-presence** (every query char present, in any order) — a valid
  necessary condition for *every* tier, so it can never drop a real match.
- **Refinement by query type:** single-word queries have no out-of-order concern → use
  the **stricter, cheaper single-pass subsequence gate**; multi-word queries → the
  presence gate. Best of both.
- **Result: ~2.2× faster at 100k, ~25% at 1k / 10k**, behavior-identical (all tests
  green), for +72 bytes gzip. Krino now **beats its parent `@nozbe/microfuzz` at every
  size** and halved the gap to uFuzzy.
- **Pinned by a correctness test** — Krino matches out-of-order multi-word (and
  diacritics) where uFuzzy's default returns nothing. That test *is* the reason the gate
  must be order-independent.
- **Takeaway:** copying a competitor's optimization means copying its **preconditions.**
  The gate is only correct because it respects a semantic (out-of-order matching) the
  competitor doesn't have. Faster is easy; faster-*and-still-correct* is the work.

## 18. Knowing when *not* to optimize

- **A trie, like fast-fuzzy?** No. A prefix trie accelerates only prefix / exact —
  Krino's *cheapest* tiers. Its expensive tiers match mid-string and out of order, and
  Krino returns *all* matches ranked (no single threshold to prune subtrees on). The
  genuine scaling levers (inverted-token + trigram index) fight the tiny/simple
  positioning and only pay past 100k. Deferred, and written down so it isn't
  re-litigated.
- **Split the "main function" for bundle size?** Measured per-module bytes first. An
  **internal** split saves nothing — `strategy` is a *runtime* arg, so the dispatch
  keeps every path reachable and the minifier merges them. Only **public, statically-
  selectable exports** would tree-shake (~0.3 kB, and only for users who never
  fuzzy-match) — not worth fragmenting a fresh 1.0 API. Perf gain: negligible (the
  branches are cheap; the string ops dominate).
- **Takeaway:** the discipline isn't optimizing — it's **measuring first and declining
  the ones that don't pay.** Two analyses that both end in "no" are wins; they're what
  keeps a 2 kB library at 2 kB.

---

# Part III — 1.0 → 2.0: the rebuild pays rent

## 19. The column we measured and never showed

- Reading microfuzz's own docs — "first search ~7 ms, subsequent under 1.5 ms, without indexing" — raised a question mine should have answered: what does *build* cost?
- The bench had measured `build index` at every size from day one; the report script only ever read the query groups.
  Same class of sin as the corpus that flattered tries: **a measured-but-unreported number is an unreported number.**
- The numbers earned the wince — ~7 ms at 10k, ~98 ms at 100k, and ~30% *slower to build* than the parent Krino beats on every query.
- One reframe survived the wince: microfuzz's "first search is slower" is the same bill on a different ledger — lazy prep charges the first keystroke, eager prep charges load time, and paying at load is the better UX.

## 20. The fastest data structure was the one I deleted

- Two changes: an ASCII fast path in `normalizeText` (pure-ASCII strings skip the NFD decompose and three regex replaces — checked *after* `toLowerCase`, which can itself surface combining marks: İ → i̇), and killing the per-field `fieldWords` Set.
  `wholeWordOccurrence` replaced it — one scan yields membership *and* position, and it fixed a latent highlight bug the Set was masking (`"catalog cat"` could underline into "catalog").
- The trade is real: membership went from an O(1) hash hit to an `indexOf` scan, so the multi-word tier now scales with field length instead of word count.
  For Krino's target fields — names, labels — the scan wins; for document-length text it's a theoretical regression bounded by the bitmask gate and the first-absent-word early exit.
- Build cost: 0.89 → 0.24 ms at 1k, 7.4 → 3.2 at 10k, 98 → 54 at 100k.
- **The surprise was where the win landed:** deleting 100k Sets cut *query* time at 100k from 13 ms to 3.4 ms — more than the pre-filter gates ever bought.
  The heap those Sets occupied was GC and cache pressure on every scan. At scale, **memory footprint is query speed.**

## 21. The reject scan went data-oriented

- The per-item union of field masks moved into one `Int32Array`: the gate reads 4 bytes per item in a flat walk, and prepared-field objects are only touched by survivors.
- The union can only false-pass on multi-field items, and the per-field mask still runs inside the ladder — correctness holds.
- Bonus nobody planned: **run-to-run variance collapsed** — a typed-array walk is far steadier than an object chase.

## 22. Typing is a sequence, not ten independent queries

- Every optimization so far treated queries as independent; the real workload — search on every keystroke — is a *sequence*, where each query extends the last.
- The prefix-narrowing cache remembers the previous query's mask-gate survivors; when the new query extends the old one, only survivors are rescanned.
- The correctness core is a monotonicity argument worth writing down: cache the **mask-pass set**, never the match set.
  The match set is not monotone under extension ("the quick brown fox" matches `fox brown` via the multi-word tier while failing `fox brow`); the mask gate is, because extending a query only adds mask bits.
  A test pins exactly that case; backspace and replacements fall back to a full scan via a `startsWith` check.
- The numbers are the headline of the whole project: typing 15 keystrokes over 100k items fell **178.9 → 27.6 ms**, per-keystroke cost decaying 6.1 → 0.5 ms as survivors narrow — sub-millisecond by mid-word.
  All for +0.1 kB of cache logic.
- **Takeaway:** profile the workload, not the function. The biggest win of the project optimized the *sequence* of calls, not any single call.

## 23. The benchmark our cache ate

- Within the hour of landing the prefix cache, the scorecard reported Krino at 0.07 ms — suspiciously half its own speed-table number. The "too good" smell was right.
- The scorecard's timing loop re-ran one query for ~50 ms, and the cache fires on equality (`startsWith` is true for the identical string) — every iteration after the first timed the survivor-rescan path while every other library paid a cold scan.
- Fix: time each call individually and bust the cache between samples with a throwaway query no test query extends.
  The honest number — 0.13 ms — landed within rounding of the independent speed table's 0.12, so two separate harnesses now agree.
- **Takeaway:** every cache invalidates a benchmark somewhere; ours invalidated our own within the hour.

## 24. Every warmup hides somebody's ledger

- microfuzz defers part of its preparation to the first search, and the harness warmup absorbed it: not in the index column, not in the query column — a cost no cell owned.
  Priced as time-to-ready: index = build + first search − one steady search (the subtraction matters — without it a query smuggles into the index cell).
- The audit then caught a second offender in the same shadow, **87× bigger**: fuzzysort's first `go()` prepares and caches every string target, absorbed by warmup, owned by no column.
  Its cold one-shot moved from 0.16 ms of fiction to ~7 ms of measurement — off the total-cost frontier entirely.
- **Takeaway:** a benchmark that flatters the *competitor* is still a broken benchmark. Audit what warmup swallowed.

## 25. Killing my own compatibility mode

- `strategy: "aggressive"` existed to reproduce microfuzz cell-for-cell — the migration mode, the parent's matcher on life support. The bench proved the reproduction: identical counts and ranks on every probe.
- The scorecard kept ranking it a hair above `smart` (0.58 vs 0.57), and that reading was MRR-blindness: its whole edge was junk-that-contains-the-source on the deep-typo probes, bought with 2–17× the rows everywhere else.
- v2 removed it. The cost is honest and published: microfuzz now outranks smart on raw MRR in Krino's own scorecard, with the prose explaining why that's the wrong lens.
- **Takeaway:** one opinionated mode is the differentiator; a compatibility story isn't. Keeping a mode whose only job was to reproduce the behaviour the fork exists to reject was the least Krino-like decision in the codebase.

## 26. The knob that was a bug wearing an API's clothes

- `strategy: "off"` existed because fuzzy junks over long text — but choosing between `smart` and `off` required exactly the knowledge the library should own.
- Measured the hazard: a purpose-built long-text bench (corpus joined into one document, probed with words verified absent) showed a smooth S-curve — 5% junk by 128 chars, 35% by 512, 98% by 16k, at every query length (50–100% junk in every query-length bucket from 4 to 13 characters at 4,096 chars).

  | doc chars | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 |
  |-----------|---:|----:|----:|----:|-----:|-----:|-----:|-----:|------:|
  | junk rate | 0% |  5% | 13% | 35% |  63% |  80% |  85% |  85% |   98% |

  No knee means an implicit length-based default would sit mid-slope, silently flipping semantics inside ordinary field sizes. Both options required user homework.
- The fix was already exported as opt-in (`matchDensity`); moved inside the tier: reject any assembly covering less than 18% of its span.
  The constant is measured, not chosen: 570 junk chains max out at 0.143 density, the sparsest genuine match (initials across a four-word name) is 0.211, and 0.18 splits the gap.
- Junk → **0% at every measured length**, label behaviour byte-identical — which zeroed `off`'s reason to exist, so the whole `strategy` option went with it. The long-text bench stayed behind as a zero-junk regression guard.
- **Takeaway:** safer *and* smaller at the same time is the sign the abstraction was wrong all along. A config knob that exists to dodge a bug *is* the bug.

---

# Part IV — the benchmark becomes a product

> Somewhere in Part III the harness stopped being a script that prints numbers and
> became the most engineered artifact in the repo. These are the decisions that got
> it there — most of them made by catching it lying.

## 27. Freeze the corpus; make density a parameter

- The corpora became committed JSON snapshots — bench runs pay no faker generation, and the data can't drift when faker changes between versions.
  Regenerating is a *deliberate act* (its own test file) that knowingly rewrites every rank table downstream.
- The accented corpus started at a measured **33% diacritics** — chosen for signal, but wildly over-representative. Recalibrated to a `mixed` corpus at ~5% (every 7th item from fr/pl generators), after measuring that faker's en — and even French *company* — generators produce 0%.
- Uniqueness measured rather than assumed: ~97% unique at 10k; duplicates are interchangeable strings, so rank checks use first occurrence.
- **Takeaway:** corpus properties (density, uniqueness, prefix structure) are benchmark *parameters*. Measure them, pin them, version them.

## 28. Score matches like an IR system, then price the noise

- "Average rank" was the intuitive ask and it doesn't survive contact: misses need an invented rank, and one rank-315 result dwarfs seven rank-1s.
  The standard fix is **MRR** — mean of `1/rank`, miss = 0 — bounded, no imputation, deep ranks self-dampen. A top-10 cutoff added on the grounds that in a UI, rank 47 *is* a miss.
- The trap arrived immediately: **Fuse.js topped the MRR table** — typo engines land the source at #1 often, *by returning everything* (~170-row result lists).
  MRR's mandatory companion is **median matches**: find-it score beside noise price. One without the other crowns whoever returns the most.
- Match count itself was demoted to a *diagnostic*, not a score — any ranked list can be sliced to top-N; junk costs nothing if it's never rendered. What it diagnoses is policy, not quality.
- **Takeaway:** borrow scoring from the field that spent decades on it, then check who the metric flatters. Every aggregate needs the companion number that keeps it honest.

## 29. Thirteen probes, each with a reason — including the ones Krino loses

- **Derived, not hand-written:** every query is generated from the frozen corpus by a fixed positional rule (first word of item 4, initials of the first 3-word item…). Nobody typed a flattering string, and derivation is what makes *rank* measurable — each query has a known right answer.
- **One probe per matching behaviour:** long word / short word (length varies how much signal gates get), two-word phrase and its **reversal** (order handling), near-unique prefix, **infix** fragment, word initials (deliberate acronym support vs accidental subsequence hits), accent-stripped, garbage (an engine that matches `qxzwkv` disqualifies its other cells).
- **Graded degradation instead of a pass/fail cliff:** the first scatter probe (`eeat`, every other letter of "Elegant") failed *everyone* — a test nobody passes measures nothing. It became a three-step gradient of one word (drop one middle char / every third / every other) that locates each engine's *effective fuzzy limit*.
- **A probe Krino cannot win, on purpose:** a transposed pair (`geenric`) is the one typo shape subsequence matching cannot represent. Only the edit-distance engines surface it — and that honest loss is what prices their scorecards fairly.
- **Takeaway:** design the probe set so every library has at least one query where its specialty should win. A comparison where the author's library can't lose isn't a comparison.

## 30. Two ledgers, two charts

- Per-query numbers alone can't rank libraries that pay for preparation in different places — eager builds, lazy first-call prep, or no state at all (preparation inside every query).
  So the scorecard reports **index**, **query**, and **total** (index + one query) separately: frontend ledger (index paid at load, keystrokes pay query) vs backend one-shot ledger (total is the real cost).
- Each ledger got a Pareto chart — MRR vs cost, log scale, frontier *computed* from the data, not asserted. On the query ledger the frontier is entirely Krino; on the total ledger uFuzzy's no-index configs earn their place and fuzzysort's hidden prepare cost knocks it off.
- Chart mechanics that turned out to matter: GitHub strips `<style>` blocks, so the SVGs inline every attribute and ship light/dark pairs behind a `<picture>` swap; alt text carries the full finding for screen readers.
- **Takeaway:** when costs land in different places, one number is an editorial choice. Publish the ledgers and let the reader pick theirs.

## 31. Omit, don't flag

- The mixed-corpus speed table dropped non-folding configurations entirely rather than marking them: a config that silently misses accented matches is timing a *different, easier task*, and we already measured the failure (base uFuzzy: 0 matches on the accent probe).
- This was the end of an evolution — dagger footnote → Valid column → Pass column → omission — each step conceding that a fast row failing the task isn't a caveat, it's a category error.
- **Takeaway:** eligibility before ranking. If a row isn't doing the task, it doesn't belong in the table, however honest the footnote.

## 32. The config that benchmarked faster than its own twin

- The scorecard kept showing `krino (acronym)` building its index *faster* than plain Krino — impossible, the acronym flag is query-time only; the builds are byte-identical.
- Cause: each config's index was timed in its own sequential ~100 ms window, and builds are allocation-heavy — one config's garbage got collected inside the *next* config's window. Order-dependent GC debt, a spurious ~10% gap.
- Fix one: interleave the samples round-robin with a rotating start, so GC pauses land evenly. Gap fell to ±3% — still enough for a 0.02 ms query delta to flip the Pareto frontier per run.
- Fix two: since the builds are *provably* the same operation (interleaved head-to-head: equal mins, equal medians), the two cells now **pool into one shared measurement** — with an assertion that fails the suite if the build paths ever genuinely diverge.
- **Takeaway:** measurements of the same operation deserve the same cell. Pool what you can prove identical, assert it stays identical, and never let sub-resolution noise pick a frontier.

## 33. Noise is one-sided; treat it that way

- Published numbers are **medians of 5 fresh processes**, each cell itself a median of individually-timed calls. The reasoning: timing noise only ever *adds* (GC, scheduler, thermals), so a mean averages the spikes in while a median rejects them.
- Rules that fell out of the war stories:
  - **Sub-10% deltas at scale are ties.** Across five runs Krino's own 100k cell ranged 1.9–2.6 ms while uFuzzy's held at 2.3 — a "97% vs 100%" reading is a coin flip, and the doc now says so.
  - **Rebuild before you measure.** One scorecard ran against a stale `dist/` after source changes and produced numbers 3× off — an entire batch discarded.
  - **A thermally-soaked machine lies politely.** A flattering 1.49 ms cell from a cold morning run was quietly unreproducible by afternoon; the published claim got softened to what survives *every* run.
  - **Drop the columns that only measure jitter:** the 1k size went — every library is sub-ms there, so its cells sat at timer granularity.
  - **Separate the dev loop from the publish ritual:** `BENCH=mixed-10k` scopes a run to one table and deliberately *can't* write the published results file; only full runs can.
- **Takeaway:** decide your noise model before your numbers, or the numbers will decide your claims.

## 34. The optional chain that taxed every keystroke

- A review-pass modernization rewrote a hot-loop line: `const i = source ? source[k] : k` became `const i = source?.[k] ?? k`. Semantically identical here (in-bounds `Int32Array` reads are never nullish; `??` can't misfire on index 0), so it looked like pure style.
- An isolated bench of just that expression, in the scan-loop shape (100k-item full scan, 10k survivor scan, medians of 100 samples):

  | variant                  | full scan  | survivors    |
  |--------------------------|-----------:|-------------:|
  | `source ? source[k] : k` | ~87–89 µs  | ~13.0–13.3 µs |
  | `source?.[k] ?? k`       | ~126–128 µs | ~17.4–17.6 µs |

- 1.33–1.45× slower: the ternary is one branch on `source`; the optional chain nullish-checks `source` *and* the loaded value, and on the full-scan path it materializes `undefined` before falling through `??`. V8 does not fold the two forms together.
- In context that's ~40 µs per 100k query, about 2% of the total: bigger than deltas the benchmarks doc explicitly calls ties.
- It also encodes a false invariant: `?? k` tells the reader `source[k]` could be nullish. It can't.
- **Takeaway:** in the loop the library exists for, idioms aren't free, and syntax that implies a wrong invariant misleads the reader and the JIT at the same time.

## 35. The keystroke tax that dissolved under interleaving

- Every query allocated a fresh survivors buffer: `new Int32Array(bound)`. At 100k a full scan's buffer is 400 kB of allocation + zeroing, measured at **64.5 µs** in isolation against **0.33 µs** for a reused buffer. Fix: double-buffer, two persistent count-sized `Int32Array`s swapping roles; the query path became allocation-free, and a sequential before/after run showed full-scan 5.87 → 5.60 ms. Shipped, wrote it up, moved on.
- Then the claim got the treatment the repo gives every number, and most of it died:
  - **Interleaved A/B** (fresh process per variant, alternating, four rounds): before ~6.3 ms, after ~6.3 ms. The sequential 5% was machine drift wearing a causal costume.
  - **GC observer** (`PerformanceObserver`, 500 query pairs): 43 events / 16.8 ms of GC before, 46 / 15.1 ms after. Typed-array churn was never a GC problem; backing stores are cheap to collect.
  - The "~10% of a warm keystroke" framing was flat wrong: the old code allocated `Int32Array(bound)`, and on warm keystrokes `bound` is the previous survivor count. Warm keystrokes were allocating kilobytes, not 400 kB; only cold full scans paid the big alloc, where 64 µs is ~1% of the 6 ms scan.
- The change stayed: allocation-free is the right shape for the hot path and the isolated cost is real; but it stayed as a hygiene call priced at two retained count-sized buffers, not as the win the first measurement claimed.
- **Takeaway:** a sequential before/after measures the machine as much as the change. Interleave fresh processes or the delta isn't yours; the smaller the claimed win, the more this rule bites.

## 36. The preallocation that benchmarked slower

- The same pass cleaned the build loop: spec defaults resolved once instead of per item × field, the per-item `specs.map` closure replaced with an indexed loop, the union-mask pass fused in, and `preparedFields` preallocated with `Array.from({ length: count })`.
- The preallocation made everything *worse*, consistently across runs: build ~17 → ~20.5 ms, and the untouched query path slowed too (session ~9.25 → ~10.2 ms).
- `Array.from({ length: n })` materializes n `undefined`s through the generic array-like protocol, and the resulting array taxed reads afterward; the plain push-built array beat it on both ends. Reverting that one line recovered every number.
- The rest of the cleanup measured noise-neutral and stayed, on strictly-less-work grounds: fewer allocations and passes can't hurt, even when the timer can't see the difference.
- **Takeaway:** optimizations are hypotheses. Two survived measurement, one died, and the casualty was the one that most resembled a textbook optimization.

## 37. The regex built for nobody, and the spread that copied for nobody

- Same hot-path audit, next block down. Two more allocations died on inspection rather than measurement:
  - `prepareQuery` built the multi-word presence gate on *every* query, but `matchField` only tests it for multi-word queries whose mask carries digit/non-ASCII bits. Every single-word keystroke (the entire session bench) paid a string-build plus `RegExp` construction for a regex nothing would run. Now built only when that condition holds, which also let the `presenceGateRedundant` flag disappear: the redundancy decision moved from a per-field branch into query prep, and the consumer collapsed to `queryWords.length > 1 ? q.presenceGate : q.fuzzyGate`.
  - The `atBest` shift spread a copy of every field match: `{ ...result, score: result.score + p.atBest }`. But `matchField` returns a fresh object literal on all nine return paths, nothing caches it, so the shift now mutates in place. The freshness contract is stated in a comment where the mutation happens, because the mutation is only legal while it holds.
- Also hoisted: the `() => null` callback for the fields array, previously re-allocated per matching item.
- Full-scan 100k query: 5.5–5.8 → 5.3–5.6 ms. Session and build within noise, as expected for allocation trims.
- The regression check that matters for a gate change is not the unit suite but the bench validation: every per-library match count and rank, identical before and after.
- **Takeaway:** allocation work can be deleted by reading the consumer, not just by timing the producer. The presence gate was "cheap" per query and still 100% waste on the dominant path.

## 38. What the searcher actually weighs

- Retained size, measured with `--expose-gc` and settled `heapUsed` deltas (stable and reproducible, unlike the timing in §35):

  | size | retained (index + both survivor buffers) | of which survivor buffers |
  |------|-----------------------------------------:|--------------------------:|
  | 10k  | 2.70 MB (~283 B/item)                    | 78 kB                     |
  | 100k | 23.3 MB (~245 B/item)                    | 781 kB                    |

- ~245 bytes/item is the price of eager preparation: the original string, its normalized form, and the mask (post-§40 diet; it was ~254 B/item before).
- A first attempt also reported "garbage per query pair" as heapUsed growth with GC off. That number was quietly meaningless: the high-allocation variant triggered GC *during* the loop and came out looking cheaper than the allocation-free one. The defensible churn metric is GC events observed over a fixed workload (§35's observer numbers); heap-growth-without-GC only works when nothing collects, and the variant most worth measuring is exactly the one that collects.
- **Takeaway:** retained memory is the trustworthy memory number; allocation churn needs a GC-aware methodology or it lies in whichever direction has more garbage.

## 39. Assert on the floor, not the middle

- The pooled-build assertion from §32 (krino's two configs must time within 25% before their cells pool) flaked under background load: `0.261 to be less than 0.25`, medians, machine busy running other benches.
- The fix follows §33's own rule: noise is one-sided, so the *minimum* is the stable, noise-free floor of a timing distribution; the median under load absorbs whatever the scheduler was doing that morning. The assertion now compares the mins of the interleaved samples (the published cells stay medians).
- Same tolerance, different statistic; the guard is strictly less flaky without being weaker, because two byte-identical builds' minimums genuinely converge.
- **Takeaway:** medians are for reporting what users experience; minimums are for asserting what the code is. Use each where it's the right estimator.

## 40. The object that was carrying its spec's luggage

- `PreparedField` held five slots per item × field: two strings, a mask, and `acronym`/`atBest`. The last two are *per-spec constants*: at 100k items, 100k copies of the same boolean and the same number, occupying object slots purely so the inner loop could read them off the nearest object.
- The diet: `acronym`/`atBest` read from the (already-hoisted) normalized spec array; the per-field masks moved into one flat `Int32Array` (item-major, `i * specCount + f`) beside the union masks; `prepareField` itself dissolved into the build loop, since all it did was assemble the object being slimmed.
- Retained memory, measured: 25.4 → **23.3 MB** at 100k, 2.93 → **2.70 MB** at 10k (~8%). Timing: unchanged under interleaved A/B, and claimed as such.
- Match parity: the full bench validation suite, identical counts and ranks everywhere.
- **Takeaway:** per-instance objects accrete per-*type* data because it's convenient at the call site. The fix is the same normalization discipline as a database schema: constants live with the spec, per-item data lives with the item, and the object that remains is only what varies.

## 41. The "invisible" bug that was 20% of every query

- Auditing `smartFuzzyMatch` by reading, not timing: when a mid-word occurrence fails the 3-char-run check, the scan cursor advanced by *one* from the previous chunk's end (`chunkEnd++`) instead of past the rejected occurrence. `indexOf` then re-found the same occurrence, one creep-step per call: O(gap²) for a single far-away reject.
- Constructed proof: a 60 kB field with one far reject cost **14.4 ms** in a single `fuzzyMatch` call. The one-line fix (`chunkEnd = idx`) took it to **0.9 ms**. Provably identical results: `indexOf` had returned the *first* occurrence past the cursor, so the skipped range contains nothing.
- The audit write-up initially called the bug "invisible on label corpora: short fields, tiny gaps." Interleaved A/B said otherwise: full-scan `gra` at 100k went ~6.2–7.0 to ~4.4–5.8 ms, the typing session ~10–11.5 to ~7.4–9.7 ms. Roughly **20%**, consistent direction across alternating rounds. Every ordinary query funnels thousands of gate-surviving fields into the fuzzy matcher, and mid-word rejections happen constantly; a few redundant `indexOf` calls per field, multiplied by corpus, was a fifth of the query.
- Longtext misses didn't move at all: absent words die at the gates before the creep loop ever runs. The pathological case and the everyday case were the same bug at different magnifications, and intuition ranked them exactly backwards.
- Match parity held everywhere: unit suite, hits, longtext, identical counts and ranks.
- **Takeaway:** a quadratic behind a gate doesn't need pathological input, only volume. And per §35, predictions about which workload feels a fix are guesses until interleaved measurement says so; this time the guess undersold the fix instead of overselling it.

## 42. Two definitions of a word boundary, and the fix nobody's tables noticed

- The same audit found the matcher and the scorer disagreeing about what a word boundary is. Chunk *eligibility* used `isValidWordBoundary` (space, hyphens, dots, quotes, slashes...); chunk *scoring* credited word-start and whole-word rates only when the neighbor was literally `" "`. So `fbar` against `"foo-bar"`: the `bar` chunk was admitted *because* the hyphen is a boundary, then priced as if it weren't.
- Tests went in before the fix, red-first: two parity assertions (`"foo-bar"` must score exactly what `"foo bar"` scores for the same query) and one absolute (a short boundary chunk is a word start at 0.4, not scattered at 1.6). All three failed against the old scorer; that failure is the bug, pinned.
- The fix is two lines: both boundary checks in the scorer now call `isValidWordBoundary`, the definition the matcher already used. Fuzzy scores stay above `BASE`, so no fuzzy match can cross under `contains`; only fuzzy-vs-fuzzy order can shift, and only around punctuation.
- The feared blast radius measured zero: 101 unit tests (no pre-existing expectation moved — they all use spaces), hits and longtext suites green, and `scorecard-run.json` — rewritten unconditionally on every run — came out byte-identical. Not one rank, count, or MRR cell moved on either corpus. The change is real for punctuated fields (product names, paths, `o'brien`) and invisible to every published number.
- **Takeaway:** when one predicate has two definitions, write the test that asserts they agree *before* unifying them; red proves the bug exists, green proves the fix, and the parity form (`"a-b"` scores like `"a b"`) guards the contract instead of a constant.

## Meta-takeaways (the reusable stuff)

Every decision above traces to one of three principles:

1. **Primitive first.** A stateless, explainable single-string matcher; the collection search is a cache and a loop, nothing more.
2. **Tests before surgery, receipts before claims.** The suite predates the redesign; the byte-identical `.d.ts` check predates the renames; the benchmarks verify matching before timing it.
3. **Tables can lie in the format, not just the data.** Capped deltas, flattering corpora, rows that skip the task, a build cost measured and never shown, a timing loop a cache quietly rewrote, a GC shadow that made twins differ — each got caught and rebuilt.


**On building it**

- **Test before you fix** — the suite finds bugs the tracker missed.
- **Write tests that survive the fix** — assert intent (tier bands), not incidental values.
- **"Shared" needs ≥2 real consumers** — don't hoist on speculation.
- **Study the field for 30 minutes** before designing scoring/ranking.
- **Expose a primitive + signals; resist growing options.** Composition beats configuration.
- **Watch for API overload** — "it's tested" isn't "it should ship."
- **Decouple the build from the compiler** (`isolatedDeclarations` / oxc).
- **OIDC > tokens** for publishing; a passkey isn't a hardware key.

**On being honest about it**

- **Measure every comparison row with one reproducible method** — your own README is the
  easiest place to fool yourself.
- **Verify each cell against source** — a comparison table is a claim about other people's
  software; don't guess.
- **Corpus shape drives benchmarks** as much as the algorithm — state it, and prefer real
  data over synthetic grids.
- **Ratios beat capped deltas** for comparisons.
- **Lead with the axis you actually win on** (for Krino: capability, not raw speed).

**On making it faster**

- **When a competitor is faster, read their source and name the mechanism.**
- **Find the one hot path** and hand it to the platform (the regex engine).
- **Copying an optimization means copying its preconditions** — safety first, or the
  speedup is a bug.
- **Measure, then decline** the optimizations that don't pay — saying "no" is how a small
  library stays small.
- **Profile the workload, not the function** — the project's biggest win optimized the
  *sequence* of calls (typing), not any single call.
- **Sometimes the optimization is deleting a structure** — heap pressure taxes every scan.

**On benchmarking as a product**

- **Freeze your inputs** — corpus snapshots are versioned data; regeneration is a deliberate act.
- **Borrow the field's metric, then price its blind spot** — MRR plus median matches; either alone lies.
- **Give every competitor a probe it should win** — including one your library *can't*.
- **Publish the ledgers, not a verdict** — index, query, and total are different users' costs.
- **Eligibility before ranking** — omit rows that aren't doing the task; don't footnote them.
- **Pool provably-identical measurements** and assert they stay identical — noise must not pick a frontier.
- **A delta below run-to-run noise is a tie.** Say so in the table.
- **Every warmup, cache, and format hides a ledger** — audit what each one swallowed.

**On v2**

- **A config knob that exists to dodge a bug *is* the bug** — fix the behaviour, delete
  the knob.
- **Derive constants from measurement and publish the derivation** — 0.18 sits between
  a measured 0.143 and 0.211; nobody has to trust taste.
- **The right default is the one that needs no documentation** — if using the library
  safely requires reading a hazard note, the hazard is the library's to fix.

## 41. Two coordinate spaces, one string

- A line-by-line analysis of `match.ts` surfaced a bug class no test had ever pinned: match ranges lived in *two* coordinate spaces.
  The `exact` and `boundary-exact` tiers scanned the raw field and reported raw offsets; every other tier reported offsets into `normalizeText(field)`.
  The spaces coincide for ASCII, precomposed, untrimmed strings — which is why 100+ tests never noticed — and drift the moment they don't.
- Three confirmed drifts, each a one-line repro:
  `"  hello"` + `he` returned `[[0, 1]]`, which highlights `" h"` (the trim shifted everything left).
  A decomposed `"Café"` (e + combining acute, the form macOS file APIs emit) put every later offset off by one.
  Hangul silently exploded: NFD turns one syllable into three jamo units, so Korean offsets were fiction.
- The fix menu ran from "document it" through "lazily remap on drifting fields" to the one we shipped: make normalisation **offset-preserving by construction**.
  The NFD-strip pipeline (microfuzz inheritance) became a per-code-point fold that guarantees one output unit per input unit — the uFuzzy-latinize / fuzzysort architecture.
  Folds that would change the length fall back to plain lowercase (Hangul syllables stay whole), then to the original code point (lone combining marks stay put).
- Honesty forced one concession before a line was written: for decomposed input, *no* 1:1 trick can exist — the matchable `"cafe"` is four units and raw `"café"` is five, pigeonhole.
  The real contract is: offsets index `NFC(text).trim()`, which **is** the caller's string whenever it is NFC-normal and untrimmed, i.e. virtually all real data.
  That sentence went in the README instead of a hazard note nobody reads.
- Unicode trivia that earned its keep: U+0130 (`İ`) is the *only* unconditional one-to-two lowercase expansion in Unicode, and its expansion unit is a combining mark our own strip deletes — it self-cancels.
  Greek final sigma is the only context-sensitive default lowercase mapping; the per-point fold loses that context, which exposed a live bug — `τελοσ` never matched `ΤΕΛΟΣ` — fixed by folding both sigmas to medial.
- The safety net for a normalisation rewrite is a characterisation harness, not courage: dump `normalizeText` over 12,274 code points before, diff after.
  Changed: 200 — the two deliberate fixes plus the Hangul/Indic/lone-mark fallbacks, and **zero Latin code points**, which is what proved the published benchmark numbers couldn't move before the bench re-run confirmed it.
- Perf came out ahead, twice.
  The fold beat the five-pass NFD pipeline ~11% on the 100k slow-path sweep; then a mid-review question — "don't maps have a higher insert cost?" — prompted an A/B that replaced the `Map` cache with a dense array through U+04FF: `Map.get`'s string hashing lost 1.8× to an indexed load, and the sweep landed 27% under the original.
  (Insert cost was the wrong suspect — at most one insert per distinct code point, ever — but the right instinct.)
- **Takeaway:** an invariant you can state ("one output unit per input unit") beats a remap you must maintain; and when two coordinate systems describe one string, every test that passes is a coincidence.

---

## Appendix: the commit map (sessions one and two)

The early history, one line per decision (reconstructed after the original draft was lost in the mikrofuzz → Krino swap):

| commit | decision |
|---|---|
| `247a6e6` | tests before surgery — suite asserts tier bands so it survives the fixes |
| `7cdf024` | oxc tooling (oxlint/oxfmt); stop bikeshedding before refactors |
| `9ca3888` | split the 283-line index.ts by concern; naming *audit* before renames |
| `89e4b01` | apply the audit; byte-identical `.d.ts` check proves "internal only"; `sideEffects: false` |
| `8af922f` | the 1.0 primitive-first redesign; six bug fixes ship inside the breaking release |
| `f5fa3f9` | unbuild → tsdown; decouple declarations from the TS compiler; bench workspace |
| `d83c7af` `07c6e1b` | migration guide; perf claims get a machine-readable artifact |
| `0876804` | npm OIDC trusted publishing — no long-lived token in CI |
| `ca7bb9e` | fix the speed table's math: relative time, not capped throughput deltas |
| `f9dc133` | the rename: unscoped, and the name states the philosophy (κρίνω) |
| `4d39076` | actually minify the bundle so the artifact matches the README claim |
| `c57ea05` | front-of-ladder pre-filter, gate chosen per query type, pinned by a correctness test |
| `d54c26b` | faker corpus (the word-grid flattered tries); correctness tests document the uFuzzy gap |
| `1b32dde` | feature-first comparison; speed demoted to a collapsible |

*Other appendix ideas: the final API at a glance; the `SCORES` tier ladder; the capability
matrix; the front-of-ladder gate (and why single-word vs multi-word pick different gates);
a diff of the 0.x → 1.0 result shape.*
