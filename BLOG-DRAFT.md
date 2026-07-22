# From 0.1 to 1.0: rebuilding a fuzzy-search library (and fighting npm to ship it)

> **Draft stub.** Structure + decisions as bullets. Flesh out prose, add code samples,
> pick a voice. Working title — swap for something punchier.

**Hook:** I opened a `KNOWN-ISSUES.md` to fix "a few bugs" in my ~2 kB fuzzy-search
library. I came out the other side with a breaking v1.0, a new build toolchain, a
benchmark suite, a rename (it's now **`krino`**), and a two-hour brawl with npm's 2FA.
Then came a *second* pass — where I caught my own benchmarks lying, verified every
comparison against the competitors' source, and landed a real ~2× speedup. Here's
every decision along the way: the engineering *and* the war stories.

---

# Part I — 0.1 → 1.0

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
- **`penalty` over `rank`:** a per-field demote-only offset covers the real use case
  ("body never outranks title") in one number; a general `rank` merge function was YAGNI
  (deferred to v1.1). `penalty ⊂ rank`.
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

## 12. The rename: `@mmmike/mikrofuzz` → `krino`

- Dropped the scope, picked a real name. **`krino`**, from Ancient Greek κρίνω ("to
  sift, separate") — the root of *criterion*, *discern*, *critic*. A fuzzy matcher
  sifts a list and judges each candidate against a criterion. The name *is* the job.
- Mechanics: package name, repo / homepage / bugs URLs, keywords, the bench
  workspace, plus a migration note (old package deprecated in favour of `krino`;
  swap the import, same 1.0 API).
- **Takeaway:** an unscoped, meaningful name is worth the churn *before* you have
  users. After, it's a migration.

## 13. My first benchmark table was (quietly) lying

- Reviewing the README before publishing, I caught my own overclaims:
  - *"the smallest option available"* — **false.** `fuzzy` (0.8 kB) and
    `@nozbe/microfuzz` (1.7 kB — the lib krino forked) are both smaller.
  - *"handles escape characters"* — an **internal** regex-escape (so a `.` in a query
    stays literal) mistaken for a user feature. Invisible plumbing.
  - *"Levenshtein like Bitap"* — imprecise; Bitap ≠ Levenshtein.
- The size table also **mixed methods**: krino's own artifact vs competitors' numbers
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

- At krino's target sizes — palettes, pickers, autocomplete over a few thousand items
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
  - **"Maintained" is not a krino edge** — Fuse and match-sorter both shipped in 2026.
- The honest position krino can stand on: the only lib returning a categorical `tier`
  *and* numeric ranges, folding diacritics, matching multi-word, with per-field config
  — all default-on, no typo machinery.
- **Takeaway:** verify each cell of a comparison or don't publish it. And lead with the
  axis where your library actually wins.

## 15. The corpus was lying too — faker vs the word-grid

- The benchmark corpus was combinatorial (`ADJ × NOUN × SUFFIX`) → **heavy shared
  prefixes** → ideal conditions for **trie-based** libraries.
- Switched to a **seeded faker corpus** (product / company / person / place names) at
  1k / 10k / 100k.
- **fast-fuzzy flipped from ~4× *faster* than krino to ~4–9× *slower*.** Its trie's
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

- uFuzzy's lesson, applied to krino: reject non-candidates with a **native regex at the
  front of the tier ladder**, before any per-item work runs.
- **The correctness trap:** uFuzzy's filter is a **subsequence** (in-order) regex. But
  krino's multi-word tier matches words **out of order** — a subsequence gate would
  wrongly reject `"foo bar"` against `"bar … foo"`. So the front gate had to be
  **order-independent char-presence** (every query char present, in any order) — a valid
  necessary condition for *every* tier, so it can never drop a real match.
- **Refinement by query type:** single-word queries have no out-of-order concern → use
  the **stricter, cheaper single-pass subsequence gate**; multi-word queries → the
  presence gate. Best of both.
- **Result: ~2.2× faster at 100k, ~25% at 1k / 10k**, behavior-identical (all tests
  green), for +72 bytes gzip. krino now **beats its parent `@nozbe/microfuzz` at every
  size** and halved the gap to uFuzzy.
- **Pinned by a correctness test** — krino matches out-of-order multi-word (and
  diacritics) where uFuzzy's default returns nothing. That test *is* the reason the gate
  must be order-independent.
- **Takeaway:** copying a competitor's optimization means copying its **preconditions.**
  The gate is only correct because it respects a semantic (out-of-order matching) the
  competitor doesn't have. Faster is easy; faster-*and-still-correct* is the work.

## 18. Knowing when *not* to optimize

- **A trie, like fast-fuzzy?** No. A prefix trie accelerates only prefix / exact —
  krino's *cheapest* tiers. Its expensive tiers match mid-string and out of order, and
  krino returns *all* matches ranked (no single threshold to prune subtrees on). The
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

## Meta-takeaways (the reusable stuff)

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
- **Lead with the axis you actually win on** (for krino: capability, not raw speed).

**On making it faster**

- **When a competitor is faster, read their source and name the mechanism.**
- **Find the one hot path** and hand it to the platform (the regex engine).
- **Copying an optimization means copying its preconditions** — safety first, or the
  speedup is a bug.
- **Measure, then decline** the optimizations that don't pay — saying "no" is how a small
  library stays small.

---

*Appendix ideas: the final API at a glance; the `SCORES` tier ladder; the capability
matrix; the benchmark methodology + corpus/faker caveats; the front-of-ladder gate (and
why single-word vs multi-word pick different gates); a diff of the 0.x → 1.0 result shape.*
