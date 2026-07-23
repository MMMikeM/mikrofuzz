# From mikrofuzz to Krino — a decision log

**Status:** draft. Reconstructed from the commit history (`247a6e6..HEAD`),
CHANGELOG, KNOWN-ISSUES, docs/naming.md, and docs/performance.md after the
original blog-post file was lost in the mikrofuzz → Krino swap. One section per
commit: what was decided, and why.

## The origin

Krino started as `@mmmike/mikrofuzz`, a fork-in-spirit of
[@nozbe/microfuzz](https://github.com/Nozbe/microfuzz). The forcing function was
real: wiring fuzzy search into a blog — short curated fields searched fuzzily, a
multi-KB body-vocabulary field searched contains-only. That integration surfaced
six bugs (KNOWN-ISSUES.md), the worst being that a **single comma demoted a
strong multi-word match into the junk-fuzzy tier** — `"build,"` never equalled
`"build"` because punctuation wasn't a word boundary. Real prose broke the
matcher. That's the itch behind everything below.

## Session one: make it correct, then make it 1.0

### `247a6e6` — tests before surgery

**Decision: build the safety net before touching anything.** A full API suite —
every tier, all three strategies, highlight semantics, sort stability — written
deliberately to *survive* the known-issue fixes: it asserts tier bands, not
exact scores, so fixing the bugs wouldn't invalidate the tests that guard the
fix. Two more bugs (empty-query match, raw-query-length highlight width) were
found while writing it and filed rather than fixed — tracker first, fix later.

### `7cdf024` — oxlint + oxfmt

**Decision: tooling from the oxc family** (fast, zero-config-ish), correctness
rules as errors. Boring on purpose; it just had to stop bikeshedding before the
refactors started.

### `9ca3888` — split the 283-line index.ts

**Decision: modules by concern, public surface frozen.** `shared.ts` (boundary
predicate), `fuzzy.ts` (chunk scoring + strategies), `match.ts` (the tier
ladder), `search.ts` (public entry points). Also wrote `docs/naming.md` — an
*audit document* of every noun and verb in the codebase — instead of renaming
things opportunistically mid-refactor.

### `89e4b01` — apply the naming audit

**Decision: rename only what the audit justified, prove nothing changed.**
`item` was overloaded three ways; it became `field` vs `item` with distinct
meanings. The check that the built `.d.ts` was **byte-identical** made "internal
only" a verified claim, not a hope. Also flipped `sideEffects: false` — the
modules were now provably side-effect-free, so bundlers can tree-shake.

### `8af922f` — the 1.0 primitive-first redesign

**The core design decision of the project.** 0.x was one function with a growing
options bag (`{ key, getText, strategy, acronym, fields }`). 1.0 inverts it:

- `fuzzyMatch(text, query, opts?)` — a **stateless primitive** returning
  `{ score, tier, ranges }` or `null`.
- `createFuzzySearch(list, getText | fieldSpec[])` — a **thin, cached wrapper**
  built on the primitive.
- **`tier`** — a categorical name beside the float, so callers rank, cut, and
  explain results without reverse-engineering `1.5` vs `1.8`.
- Stringly `key` removed (a function is typed; a string isn't); parallel
  `matches`/`scores` arrays replaced by one `fields` array.

The six bug fixes shipped inside the same breaking release — fixing tier
assignment *changes scores*, so a major was the honest place for them. First
perf work also landed here: a native regex subsequence gate on the fuzzy tier
(~2× on fuzzy-heavy queries).

### `f5fa3f9` — unbuild → tsdown

**Decision: stop depending on the TypeScript compiler API for declarations.**
TS7 broke the unbuild pipeline (rollup-plugin-dts is maintenance-mode); tsdown
generates declarations via oxc `isolatedDeclarations`, so the build survives TS
upgrades. Same commit moved benchmarks into a private `bench/` workspace —
competitor libraries as deps of the comparison, not of the library.

### `d83c7af`, `07c6e1b` — migration guide + first perf tables

**Decision: breaking changes get a before/after diff doc**, and performance
claims get a machine-readable artifact (`results.json`) instead of hand-typed
numbers.

### `0876804` — npm OIDC trusted publishing

**Decision: no long-lived npm token in CI.** GitHub Actions OIDC identity,
automatic provenance.

### `ca7bb9e` — fix the speed table's math

**Decision: relative *time*, not throughput delta.** The old ±% throughput
format capped every slower library at −100%: Fuse.js read "−93%" while actually
~14× slower. Same data, honest denominator — Fuse.js now reads ~1400%.
First instance of what became the project's benchmarking theme: the table
format itself can lie.

## Session two: the rename, and benchmarks that stop lying

### `f9dc133` — mikrofuzz → Krino

**Decision: unscoped name, and a name that states the philosophy.** Krino, from
κρίνω — "to sift, separate, judge" (same root as *criterion* and *critic*). A
fuzzy matcher sifts a list and judges candidates — which is literally what the
tier ladder does. Being unscoped also dropped the `@mmmike/` namespace tax.
(The swap is where the original blog draft and session history were lost —
hence this reconstruction.)

### `4d39076` — actually minify the bundle

**Decision: the published artifact must match the README's size claim.** The
build was comments-only stripping while the README said ~1.9 kB. Honesty
patch, four lines.

### `c57ea05` — front-of-ladder pre-filter

**Decision: adopt uFuzzy's insight (a native regex can bulk-reject
non-candidates) without adopting its semantics.** The gate is chosen per query
type: single-word queries get the strict single-pass subsequence gate;
multi-word queries need the order-independent presence gate, because Krino's
multi-word tier matches words out of order and a subsequence gate would wrongly
reject them. ~2.2× at 100k. The distinction is pinned by a correctness test —
the pre-filter can't silently break the semantics it was built around.

### `d54c26b` — faker corpus + eight-library comparison

**Decision: natural-language benchmark data, because the corpus was flattering
a competitor.** The original combinatorial word-grid (`ADJ × NOUN × SUFFIX`)
produced heavy shared prefixes — ideal for fast-fuzzy's trie, which benched ~4×
faster than Krino. On seeded faker names the trie's advantage evaporated
(fast-fuzzy fell to ~4–9× slower). Corpus shape, not algorithm, drove the
number. Also added `correctness.test.ts`: the cases Krino handles that uFuzzy's
defaults don't, so the speed gap has documented context.

### `1b32dde` — feature-first comparison

**Decision: lead with what you get back, not how fast you got it.** At Krino's
target sizes every non-typo library answers in well under a millisecond, so the
README comparison was rebuilt around a verified capability matrix (ranges /
tier / diacritics / multi-word / per-field / typos), with size & speed demoted
to a collapsible section. `docs/performance.md` captured the trie/index
analysis with a verdict of **defer** — an index fights the tiny-bundle
positioning and only pays off past Krino's stated scale.

## Session three (uncommitted at time of writing)

The current working tree continues the arc:

- **Dual ESM/CJS** with a proper `exports` map (arethetypeswrong-clean). The
  original motive for leaving microfuzz was partly its CJS-only packaging
  biting in CF Workers / Vite; Krino now ships both. Bundle honesty updated:
  ~2.0 kB.
- **O(1) char-class bitmask pre-gate** (fuzzysort's trick) in front of the
  regex gates — 0.95 ms → 0.39 ms at 10k. The funnel diagnostics it came with
  found the presence regex cutting 0.0% after the mask for pure a–z queries,
  so it's now skipped.
- **Benchmarks that verify the matching before timing it**: two corpora (ascii
  vs accented — fr/pl generators chosen after *measuring* that faker's en and
  even French-company generators produce 0% diacritics), "(all opts)" rows so
  nobody is fast by skipping work, a result sink so the JIT can't
  dead-code-eliminate the timed work, and `hits.test.ts` — every query knows
  which corpus item it was derived from, and every library is scored on
  matches *and* the rank of that source item. Headline finds: Krino's
  `aggressive` strategy reproduces microfuzz **cell-for-cell** (that mode *is*
  the parent's behaviour; `smart` is the actual design change), uFuzzy
  silently returns 0 on accent-stripped queries without `latinize`, and the
  typo engines return 3–10× the true hit count.
- **Graded fuzzy probes instead of a doom query.** The first scatter probe
  (`eeat`, every other letter of "Elegant") failed *everyone* — a test nobody
  passes measures nothing. It became a three-step gradient of one source word
  (drop one middle char / every third / every other) that locates each
  engine's effective fuzzy limit: Krino's `smart` absorbs a one-char slip with
  the smallest result set, then refuses outright at two gaps (returning
  nothing beats returning 135 junk chains); aggressive/microfuzz never give
  up; uFuzzy's defaults never start.
- **Corpus density is a parameter, not an accident.** The accented corpus
  started at a measured 33% diacritics — over-representative — and was
  recalibrated to a `mixed` corpus at ~5% (every 7th item from fr/pl
  generators), with uniqueness (~97% at 10k) measured rather than assumed.
- **Results moved to their own file.** The per-query match/rank tables and the
  two-corpus speed tables now live in `docs/benchmarks.md`; the README keeps a
  two-bullet summary beside the verified capability matrix. Presentation
  lesson from getting there: rank sits before match count, because where the
  right answer lands matters more than how much came back.
- **The column we measured and never showed.**
  Reading microfuzz's own docs — "first search ~7 ms, subsequent under 1.5 ms, without indexing" — raised a question ours should have answered: what does *build* cost?
  It turned out the bench had measured `build index` at every size from day one, and the report script only ever read the query groups.
  Same class of sin as the corpus that flattered tries: a measured-but-unreported number is an unreported number.
  The numbers earned the wince — ~7 ms at 10k, ~98 ms at 100k, and ~30% *slower to build* than the parent Krino beats on every query.
  One reframe survived the wince: microfuzz's "first search is slower" is the same bill on a different ledger — lazy prep charges the first keystroke, eager prep charges load time, and paying at load is the better UX.
- **The fix was deleting a data structure.**
  Two changes: an ASCII fast path in `normalizeText` (pure-ASCII strings skip the NFD decompose and three regex replaces — checked *after* `toLowerCase`, which can itself surface combining marks: İ → i̇), and killing the per-field `fieldWords` Set.
  `wholeWordOccurrence` replaced it — a scan for an occurrence bounded by non-word characters on both sides, which yields membership *and* position in one pass.
  That also fixed a latent highlight bug: the old range came from a left-bounded search, so `"catalog cat"` could underline into "catalog".
  The trade is real, though: membership went from an O(1) hash hit to an `indexOf` scan, so the multi-word tier now scales with field length instead of word count.
  For Krino's target fields — names, labels — the scan beats hashing; for document-length fields (`strategy: "off"` body text) it's a theoretical regression the short-string bench never measures, bounded in practice by the bitmask gate rejecting most items before any tier runs and the loop stopping at the first absent word.
  Build cost: 0.89 → 0.24 ms at 1k, 7.4 → 3.2 at 10k, 98 → 54 at 100k.
- **The surprise was where the win landed.**
  Deleting 100k Sets cut *query* time at 100k from 13 ms to 3.4 ms — more than the pre-filter gates ever bought — because the heap those Sets occupied was GC and cache pressure on every scan.
  At small sizes nothing changed; at scale, memory footprint *is* query speed.
  Sometimes the optimization is not a cleverer structure but the deletion of one.
- **The reject scan went data-oriented.**
  The per-item union of field masks moved into one `Int32Array`: the gate now reads 4 bytes per item in a flat walk, and prepared-field objects are only touched by survivors.
  The union can only false-pass on multi-field items, and the per-field mask check still runs inside the ladder, so correctness holds.
  Bonus nobody planned: run-to-run variance collapsed — a typed-array walk is far steadier than an object chase.
- **Then the searcher learned what typing actually is.**
  Every optimization so far treated queries as independent; the real workload — search on every keystroke — is a *sequence*, where each query extends the last.
  The prefix-narrowing cache exploits that: remember the previous query's mask-gate survivors, and when the new query extends the old one, rescan only them.
  The correctness core is a monotonicity argument worth writing down: the cache stores the **mask-pass set**, never the match set — the match set is not monotone under extension ("the quick brown fox" matches `fox brown` via the multi-word tier while failing `fox brow`), but the mask gate is, because extending a query only adds mask bits.
  A test pins exactly that case; backspace and replacement queries fall back to a full scan via a `startsWith` check.
  The numbers are the headline of the whole project: typing 15 keystrokes over 100k items fell from 178.9 ms to 27.6 ms, with per-keystroke cost decaying 6.1 → 0.5 ms as survivors narrow — sub-millisecond keystrokes by mid-word, ~25× faster late in the phrase.
  Cumulative at 100k: build ~100 → 19.2 ms, nine independent mixed queries 83.5 → 13.2 ms, all for +0.1 kB of cache logic.
  The lesson: profile the workload, not the function — the biggest win of the project came from optimizing the *sequence* of calls, not any single call.
- **The benchmark our cache ate.**
  Within the hour of landing the prefix cache, the scorecard reported Krino at 0.07 ms — suspiciously half its own speed-table number, and the "too good" smell was right.
  The scorecard's timing loop re-runs one query for ~50 ms, and the cache fires on equality (`startsWith` is true for the identical string), so every iteration after the first timed the survivor-rescan path while every other library paid a cold scan.
  The fix times each call individually and busts the cache between samples with a throwaway query no test query extends.
  The honest number — 0.13 ms — landed within a rounding error of the independent speed table's 0.12, so two separate harnesses now agree, and the headline survived the correction: Krino still leads the fast pack on the mixed corpus, it just stopped being twice as flattering.
  Every cache invalidates a benchmark somewhere; ours invalidated our own within the hour.

- **The lazy slice that escaped both ledgers.**
  microfuzz defers part of its preparation to the first search, and the harness warmup absorbed it: not in the index column, not in the query column — the only cost in the whole comparison that no cell owned.
  The fix prices it as time-to-ready: index = build + first search − one steady search, so the index column owns every one-time cost and the query column stays a pure keystroke.
  The subtraction matters — build + first search alone smuggles a query into the index cell; removing one steady search isolates preparation exactly.
  microfuzz's index went 6.8 → 7.8 ms at 10k. A benchmark that flatters the *competitor* is still a broken benchmark.
  The audit then caught a second offender in the same shadow: fuzzysort's first `go()` prepares and caches every string target — **87×** a steady query at 10k, absorbed by warmup, owned by no column.
  Its index cell now times an explicit prepare-all pass (the lazy fill is observable only once per process; the explicit pass is the same work, repeatable), and its cold one-shot moved from 0.16 ms of fiction to ~7 ms of measurement — off the total-cost frontier entirely.
  Two libraries, two directions, one lesson: every warmup absorbs somebody's ledger; audit what it swallowed.
- **Then the fork finally picked a side.**
  `strategy: "aggressive"` existed to reproduce microfuzz cell-for-cell — the migration mode, the parent's matcher kept on life support.
  The scorecard kept ranking it a hair above `smart` (0.58 vs 0.57), and that reading is exactly the MRR blindness documented above: its whole edge was junk-that-contains-the-source on the deep-typo probes, bought with 2–17× the rows everywhere else.
  v2 removed it. `Strategy` is now `"off" | "smart"`: one opinionated fuzzy mode, doing one thing well — the differentiator is the opinion, not a compatibility story.
  The cost is honest and published: microfuzz now outranks smart on raw MRR in Krino's own scorecard, with the prose explaining why that's the wrong lens.
  Keeping a mode whose only job was to reproduce the behaviour the fork exists to reject was the least Krino-like decision in the codebase; deleting it was overdue.

## The through-line

Every decision traces to one of three principles:

1. **Primitive first.** A stateless, explainable single-string matcher; the
   collection search is a cache and a loop, nothing more.
2. **Tests before surgery, receipts before claims.** The suite predates the
   redesign; the byte-identical `.d.ts` check predates the renames; the
   benchmarks verify matching before timing it.
3. **Tables can lie in the format, not just the data.** Throughput deltas that
   cap at −100%, corpora that flatter tries, speed rows that skip the task, a
   build cost measured from day one and never shown, a timing loop the prefix
   cache quietly turned into a different measurement — each got caught and
   rebuilt.
