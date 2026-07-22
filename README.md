# Krino

A tiny, typed fuzzy matcher. ~1.9 kB gzip, TS-first ESM, zero deps. A primitive-first rebuild of [@nozbe/microfuzz](https://github.com/Nozbe/microfuzz) with a new API and `tier` / `ranges` results.

What makes Krino different?

1. **Tiny:** ~1.9 kB gzip, zero dependencies.
2. **Informative:** returns the `ranges` it matched and a `tier` naming the kind of match — so you can rank, highlight, and explain a result without reverse-engineering a float.
3. **Focused:** a fuzzy text matcher — handles diacritics and acronyms. No typos, no edit-distance / Bitap matching.

For filtering a list you already have — command palettes, pickers, autocomplete — as fast and ergonomic as possible.

## Install

```bash
pnpm add krino
```

> **Coming from `@mmmike/mikrofuzz`?** Same 1.0 API, just renamed, swap the import. Upgrading from 0.x? It's a breaking redesign, see [MIGRATION.md](./MIGRATION.md).

## Two entry points

### `fuzzyMatch` — score one string

```typescript
import { fuzzyMatch } from "krino";

fuzzyMatch("Hello World", "wor");
// { score: 1, tier: "boundary", ranges: [[6, 8]] }

fuzzyMatch("cherry", "xyz"); // null
```

Options: `fuzzyMatch(text, query, { strategy?, acronym? })`.

### `createFuzzySearch` — search a collection

```typescript
import { createFuzzySearch, SCORES } from "krino";

// array of strings
const search = createFuzzySearch(["apple", "banana", "cherry"]);
search("ban");
// [{ item: "banana", score: 0.5, fields: [{ score: 0.5, tier: "prefix", ranges: [[0, 2]] }] }]

// objects — a function extracts the text to search
const byName = createFuzzySearch(users, (u) => u.name);
byName("john");

// multiple fields, per-field config
const search = createFuzzySearch(posts, [
  { text: (p) => p.title, strategy: "smart" },
  { text: (p) => p.body, strategy: "off", penalty: SCORES.CONTAINS }, // body never outranks title
]);
```

Results are sorted best-first (stable), and preprocessing is cached — build once, query many.

## Scoring

Lower is better. Each match reports a numeric `score` (for sorting) and a categorical `tier`:

| score | tier | meaning |
|-------|------|---------|
| 0 | `exact` | exact match |
| 0.1 | `normalized-exact` | case / diacritics-insensitive exact |
| 0.5 | `prefix` | starts with query |
| 0.9 | `boundary-exact` | at a word boundary, exact case |
| 1 | `boundary` | at a word boundary |
| 1.5 | `multi-word` | all query words present, any order |
| 1.8 | `acronym` | word initials (opt-in via `acronym: true`) |
| 2 | `contains` | contains query anywhere |
| > 2 | `fuzzy` | fuzzy chain (fewer chunks = better) |

Import `SCORES` for thresholds and penalties; or read `tier` directly:

```typescript
results.filter((r) => r.score <= SCORES.CONTAINS); // drop fuzzy chains
results.filter((r) => r.fields[0]?.tier !== "fuzzy"); // same, categorically
```

> **Long text:** fuzzy strategies assemble short queries out of scattered chunks, so over
> document-length text almost anything "matches". Scope `smart`/`aggressive` to short labels
> (titles, names); use `strategy: "off"` for long body text.

## Strategies

| strategy | matches |
|----------|---------|
| `smart` (default) | word boundaries or 3+ character chunks |
| `aggressive` | any letters in order |
| `off` | exact / prefix / boundary / contains only (no fuzzy) |

## Comparison

At the sizes krino targets — lists you already hold: palettes, pickers,
autocomplete (hundreds to a few thousand items) — every non-typo library here
answers a query in **well under a millisecond**, so raw speed rarely decides. What
differs is **what you get back**. Each cell below is verified against the library's
current source.

| Library | Ranges | Tier | Diacritics | Multi-word | Per-field | Typos |
|---------|:------:|:----:|:----------:|:----------:|:---------:|:-----:|
| **krino** | ✓ | **✓** | ✓ | ✓ | ✓ | — |
| [@nozbe/microfuzz](https://github.com/Nozbe/microfuzz) | ✓ | — | ✓ | ✓ | ✓ | — |
| [fuzzysort](https://github.com/farzher/fuzzysort) | ✓ | — | ✓ | ✓ | ✓ | — |
| [match-sorter](https://github.com/kentcdodds/match-sorter) | — | ✓ | ✓ | — | ✓ | — |
| [uFuzzy](https://github.com/leeoniya/uFuzzy) | ✓ | — | ○ | ○ | — | ○ |
| [fuzzy](https://github.com/mattyork/fuzzy) | ○ | — | — | — | — | — |
| [Fuse.js](https://www.fusejs.io/) | ○ | — | ○ | ○ | ✓ | ✓ |
| [fast-fuzzy](https://github.com/EthanRutherford/fast-fuzzy) | ○ | — | — | — | ✓ | ✓ |

✓ built-in / on by default · ○ opt-in or partial · — not supported. The `○`s:
uFuzzy folds diacritics via `latinize()`, matches multi-word via `outOfOrder`, and
tolerates one typo via `SingleError`; Fuse returns `ranges` via `includeMatches`,
folds diacritics via `ignoreDiacritics`, and matches multi-word via token search;
fast-fuzzy's `ranges` are one span (`index`+`length`), not per-character, and its
default normalization doesn't strip accents; `fuzzy`'s "ranges" are a pre-wrapped
string, not numeric indices.

**Reading it:** krino is the only library that returns a categorical **`tier`**
*and* numeric `ranges`, folds diacritics, matches multi-word, and takes per-field
config — all on by default, no typo machinery. `match-sorter` also exposes a tier
but gives you no ranges and no multi-word. `fuzzysort` and `@nozbe/microfuzz` come
closest on capability but expose no tier (and both ship CJS; microfuzz last
released 2023). If you need to match *through* typos, reach for a different tool —
`Fuse.js` (Bitap) or `fast-fuzzy` (edit-distance) — at a bundle and ergonomics
cost. All eight ship TypeScript types; krino is ESM-only.

<details>
<summary><b>Size, speed &amp; search type</b> — positioning, not a leaderboard</summary>

One uniform method. **Gzip** = esbuild `--bundle --minify` + gzip, tree-shaken to
each lib's primary API. **1k / 10k / 100k** = per-query time at that list size,
relative to krino (100% = same, lower = faster), over a seeded faker corpus
(real-ish product / company / person / place names). Absolute times + method are
in [`bench/comparison.json`](./bench/comparison.json); regenerate with `pnpm bench
&& node bench/report.mjs`. **Numbers vary per machine.** Grouped by type; within a
type, sorted by size.

| # | Library | Gzip | Deps | 1k | 10k | 100k | Type |
|---|---------|------|------|-----|-----|------|------|
| 1 | @nozbe/microfuzz | ~1.7 kB | 0 | 121% | 129% | 160% | subsequence |
| 2 | **krino** | **~1.9 kB** | 0 | **100%** | **100%** | **100%** | subsequence (tiered) |
| 3 | match-sorter | ~3.4 kB | 2 | 339% | 360% | 329% | subsequence (tiered) |
| 4 | fuzzysort | ~3.7 kB | 0 | 19% | 38% | 75% | subsequence |
| 5 | uFuzzy | ~4.1 kB | 0 | 21% | 30% | 27% | subsequence |
| 6 | Fuse.js | ~9.3 kB | 0 | 1919% | 1989% | 1638% | typo-tolerant |
| 7 | fast-fuzzy | ~11 kB | 1 | 997% | 1093% | 943% | typo-tolerant |
| 8 | fuzzy | ~0.8 kB | 0 | 227% | 246% | 228% | substring |

Absolute per-query at 1k: krino 0.07 ms, microfuzz 0.09, uFuzzy 0.02, fuzzysort
0.01 — all invisible; speed only starts to matter past ~10k (krino ~0.7 ms) and at
100k (krino ~9 ms). A native pre-filter skips the tier ladder for non-candidates
(single-word queries gate on a subsequence regex, multi-word on order-independent
char-presence), so krino now beats its parent `@nozbe/microfuzz` at every size.
Cross-*type* speed isn't apples-to-apples: **typo-tolerant**
libs (Fuse.js, fast-fuzzy) do far more work; the fast **subsequence** libs (uFuzzy,
fuzzysort) do less per match — no diacritic folding / tiers / multi-word by default
— so they lead. uFuzzy in particular is a single native-regex filter that ranks only
survivors, where krino runs a full tier ladder and builds a `tier` + per-character
`ranges` per match — richer output, more work; the residual gap is that trade, not
overhead we can gate away. **fast-fuzzy is corpus-sensitive**: its trie shines on shared-prefix
data but this natural-language corpus prunes less, dropping it among the slowest
(on a combinatorial word-grid it was ~4× *faster* than krino — corpus shape moves
these numbers a lot). For 100k+ corpora, prefer `uFuzzy` or `fuzzysort`.
Preprocessing is cached in `createFuzzySearch` (build once, query many).

</details>

## Building blocks

- `normalizeText(str)` — lowercase, strip diacritics.
- `splitWords(str)` — tokenize on any non-alphanumeric run (keeps `_`).
- `matchDensity(ranges)` — matched characters ÷ inclusive span (a junk-chain discriminator).
- `SCORES` — the tier constants.

## Types

```typescript
type Range = [number, number]; // [start, end] inclusive
type Strategy = "off" | "smart" | "aggressive";
type Tier =
  | "exact" | "normalized-exact" | "prefix" | "boundary-exact"
  | "boundary" | "multi-word" | "acronym" | "contains" | "fuzzy";

type MatchResult = { score: number; tier: Tier; ranges: Range[] };

type FieldSpec<T> = {
  text: (item: T) => string | null;
  strategy?: Strategy;   // default "smart"
  acronym?: boolean;     // default false
  penalty?: number;      // added to this field's score; higher demotes it
};

type FuzzyResult<T> = {
  item: T;
  score: number;                       // min effective score across fields
  fields: Array<MatchResult | null>;   // one per field spec
};
```

## The name

Krino, from Ancient Greek κρίνω (KREE-no), PIE `*krey-`, "to sift, separate." The same root as criterion, discern, and critic. A fuzzy matcher sifts a list and judges each candidate against a criterion.

## License

MIT
