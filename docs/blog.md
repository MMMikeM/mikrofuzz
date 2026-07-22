# From mikrofuzz to krino — a decision log

**Status:** draft. Reconstructed from the commit history (`247a6e6..HEAD`),
CHANGELOG, KNOWN-ISSUES, docs/naming.md, and docs/performance.md after the
original blog-post file was lost in the mikrofuzz → krino swap. One section per
commit: what was decided, and why.

## The origin

krino started as `@mmmike/mikrofuzz`, a fork-in-spirit of
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

### `f9dc133` — mikrofuzz → krino

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
multi-word queries need the order-independent presence gate, because krino's
multi-word tier matches words out of order and a subsequence gate would wrongly
reject them. ~2.2× at 100k. The distinction is pinned by a correctness test —
the pre-filter can't silently break the semantics it was built around.

### `d54c26b` — faker corpus + eight-library comparison

**Decision: natural-language benchmark data, because the corpus was flattering
a competitor.** The original combinatorial word-grid (`ADJ × NOUN × SUFFIX`)
produced heavy shared prefixes — ideal for fast-fuzzy's trie, which benched ~4×
faster than krino. On seeded faker names the trie's advantage evaporated
(fast-fuzzy fell to ~4–9× slower). Corpus shape, not algorithm, drove the
number. Also added `correctness.test.ts`: the cases krino handles that uFuzzy's
defaults don't, so the speed gap has documented context.

### `1b32dde` — feature-first comparison

**Decision: lead with what you get back, not how fast you got it.** At krino's
target sizes every non-typo library answers in well under a millisecond, so the
README comparison was rebuilt around a verified capability matrix (ranges /
tier / diacritics / multi-word / per-field / typos), with size & speed demoted
to a collapsible section. `docs/performance.md` captured the trie/index
analysis with a verdict of **defer** — an index fights the tiny-bundle
positioning and only pays off past krino's stated scale.

## Session three (uncommitted at time of writing)

The current working tree continues the arc:

- **Dual ESM/CJS** with a proper `exports` map (arethetypeswrong-clean). The
  original motive for leaving microfuzz was partly its CJS-only packaging
  biting in CF Workers / Vite; krino now ships both. Bundle honesty updated:
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
  matches *and* the rank of that source item. Headline finds: krino's
  `aggressive` strategy reproduces microfuzz **cell-for-cell** (that mode *is*
  the parent's behaviour; `smart` is the actual design change), uFuzzy
  silently returns 0 on accent-stripped queries without `latinize`, and the
  typo engines return 3–10× the true hit count.
- **Graded fuzzy probes instead of a doom query.** The first scatter probe
  (`eeat`, every other letter of "Elegant") failed *everyone* — a test nobody
  passes measures nothing. It became a three-step gradient of one source word
  (drop one middle char / every third / every other) that locates each
  engine's effective fuzzy limit: krino's `smart` absorbs a one-char slip with
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

## The through-line

Every decision traces to one of three principles:

1. **Primitive first.** A stateless, explainable single-string matcher; the
   collection search is a cache and a loop, nothing more.
2. **Tests before surgery, receipts before claims.** The suite predates the
   redesign; the byte-identical `.d.ts` check predates the renames; the
   benchmarks verify matching before timing it.
3. **Tables can lie in the format, not just the data.** Throughput deltas that
   cap at −100%, corpora that flatter tries, speed rows that skip the task —
   each got caught and rebuilt.
