# @mmmike/mikrofuzz

Zero-dependency fuzzy search with smart word-boundary matching. ~2.5 kB gzip, ESM, fully typed. Adapted from [@nozbe/microfuzz](https://github.com/Nozbe/microfuzz) with ESM / Vite SSR compatibility.

## Install

```bash
pnpm add @mmmike/mikrofuzz
```

## Two entry points

### `fuzzyMatch` — score one string

```typescript
import { fuzzyMatch } from "@mmmike/mikrofuzz";

fuzzyMatch("Hello World", "wor");
// { score: 1, tier: "boundary", ranges: [[6, 8]] }

fuzzyMatch("cherry", "xyz"); // null
```

Options: `fuzzyMatch(text, query, { strategy?, acronym? })`.

### `createFuzzySearch` — search a collection

```typescript
import { createFuzzySearch, SCORES } from "@mmmike/mikrofuzz";

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

## License

MIT
