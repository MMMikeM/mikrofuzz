# @mmmike/mikrofuzz

Zero-dependency fuzzy search library with smart word-boundary matching. Adapted from [@nozbe/microfuzz](https://github.com/Nozbe/microfuzz) with ESM and Vite SSR compatibility.

## Features

- **Zero dependencies** - Pure JavaScript implementation
- **Smart matching** - Prioritizes word boundaries over arbitrary letter matches
- **Scoring system** - Lower scores = better matches
- **TypeScript** - Full type definitions included
- **Highlight ranges** - Returns match positions for highlighting

## Installation

```bash
npm install @mmmike/mikrofuzz
```

## Usage

### Search an Array of Strings

```typescript
import { createFuzzySearch } from "@mmmike/mikrofuzz";

const fruits = ["apple", "banana", "cherry", "grape"];
const search = createFuzzySearch(fruits);

const results = search("ban");
// [{ item: "banana", score: 0.5, matches: [[[0, 2]]] }]
```

### Search Objects by Key

```typescript
const users = [
  { id: 1, name: "John Doe" },
  { id: 2, name: "Jane Smith" },
];

const search = createFuzzySearch(users, { key: "name" });
const results = search("john");
// [{ item: { id: 1, name: "John Doe" }, score: 1, matches: [...] }]
```

### Search Multiple Fields

```typescript
const users = [
  { name: "John Doe", email: "john@example.com" },
  { name: "Jane Smith", email: "jane@example.com" },
];

const search = createFuzzySearch(users, {
  getText: (user) => [user.name, user.email],
});

const results = search("john");
// Matches both name and email fields
```

### One-Off Match

```typescript
import { fuzzyMatch } from "@mmmike/mikrofuzz";

const result = fuzzyMatch("Hello World", "wor");
// { item: "Hello World", score: 1, matches: [[[6, 8]]] }
```

## Scoring

Lower scores indicate better matches:

| Score | Match Type |
|-------|------------|
| 0 | Exact match |
| 0.1 | Case/diacritics-insensitive exact match |
| 0.5 | Starts with query |
| 0.9 | Contains at word boundary (exact case) |
| 1 | Contains at word boundary |
| 1.5+ | Contains all query words (any order) |
| 2 | Contains query anywhere |
| 2+ | Fuzzy match (fewer chunks = better) |

## Search Strategies

```typescript
const search = createFuzzySearch(items, { strategy: "smart" }); // default
```

| Strategy | Description |
|----------|-------------|
| `"smart"` | Matches at word boundaries or 3+ character chunks |
| `"aggressive"` | Classic fuzzy matching (any letters in order) |
| `"off"` | Only exact, prefix, and contains matching |

## API Reference

### `createFuzzySearch<T>(collection, options?)`

Creates a reusable search function for a collection.

**Options:**
- `key?: string` - Property name to search (for object arrays)
- `getText?: (item: T) => Array<string | null>` - Custom text extraction
- `strategy?: "smart" | "aggressive" | "off"` - Matching strategy

**Returns:** `(query: string) => FuzzyResult<T>[]`

### `fuzzyMatch(text, query)`

One-off fuzzy match for a single string.

**Returns:** `FuzzyResult<string> | null`

### `normalizeText(str)`

Normalize text (lowercase, remove diacritics).

## Types

```typescript
type Range = [number, number]; // [start, end] inclusive indices
type HighlightRanges = Range[];
type FuzzyMatches = Array<HighlightRanges | null>;

interface FuzzyResult<T> {
  item: T;
  score: number;
  matches: FuzzyMatches;
}

interface FuzzySearchOptions {
  key?: string;
  getText?: (item: unknown) => Array<string | null>;
  strategy?: "off" | "smart" | "aggressive";
}
```

## License

MIT
