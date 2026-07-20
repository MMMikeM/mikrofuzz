# Naming audit

An audit of the vocabulary used across `src/`. This is **documentation only** —
it records what each term means today and flags where the same concept is named
inconsistently, with a recommended canonical name per case. No identifiers were
renamed in producing it; the recommendations are for a future rename PR.

## Nouns

| Noun | Meaning | Where |
|---|---|---|
| `item` | **Overloaded.** (1) a single raw field string; (2) the whole collection element `T`. | `matchesFuzzily` param; `createFuzzySearch` inner `item`; public `FuzzyResult.item` |
| `element` | one collection entry `T` | `createFuzzySearch` map var, query loop |
| `collection` | the input array `T[]` | `createFuzzySearch` param |
| `text` / `texts` | a raw searchable string / the array of them for one element | public `fuzzyMatch(text,…)`; `createFuzzySearch`; `getText` |
| `field` | conceptual: one searchable string per element | types doc ("each text field") — no literal identifier |
| `query` | the raw search string | everywhere |
| `queryWords` | query split on `" "` | `fuzzyMatch`, `createFuzzySearch`, `matchesFuzzily` |
| `itemWords` / word `Set` | set of normalized item words | `matchesFuzzily`, preprocessing |
| `match` / `matches` | (1) a single `[score, ranges]` result; (2) `FuzzyResult.matches` per-field list; (3) local `matches` | `matchesFuzzily`, `FuzzyResult`, `createFuzzySearch` |
| `Range` | `[number, number]` inclusive — **reused** for highlight spans and chunk index-pairs | `types.ts`, `sortRangeTuple`, `indices` elements |
| `HighlightRanges` | `Range[]` | types, return shapes |
| `FuzzyMatches` | `Array<HighlightRanges \| null>` | types, `matches` |
| `chunk` | a run of consecutive matched indices | `scoreConsecutiveLetters`, `fuzzy.ts` (`chunkFirstIdx`/`chunkLastIdx`/`chunkLength`/`minChunkLen`) |
| `indices` | **misnomer:** a `HighlightRanges` (list of chunk pairs), not bare indices | `scoreConsecutiveLetters`, both strategies |
| `score` | numeric match quality, lower = better | everywhere |
| `tier` | the ladder levels 0/0.1/0.5/… | header docstring, `SCORE_*` constants |
| `boundary` / word boundary | delimiter characters | `shared.ts` (`validWordBoundaries`, `isValidWordBoundary`) |
| `word` | a token; also start/end-of-word tests | `queryWords`, `itemWords`, `isStartOfWord`, `isEndOfWord` |
| `occurrence` | position where the query occurs | `containsIdx`, `exactContainsIdx` |
| `strategy` | `"off" \| "smart" \| "aggressive"` | `FuzzySearchStrategy`, `options.strategy`, `matchesFuzzily` |
| `result` / `results` | a match result / the result list | `matchesFuzzily` local, `FuzzyResult`, `createFuzzySearch` |
| `searcher` | the prepared query closure | `FuzzySearcher` |
| `options` | search config | `FuzzySearchOptions` |
| `key` | property name to read | `options.key` |
| `getText` | field extractor fn | `options.getText` |
| `preprocessed` / `processed` | precomputed per-element / per-field tuples | `createFuzzySearch` |
| `normalizedItem` / `normalizedText` / `normalized` | the normalized field string (three names) | `matchesFuzzily` / `fuzzyMatch` / `createFuzzySearch` |
| `queryChar` | current query character | `fuzzy.ts` strategies |
| `minQueryChunk` | query slice for the smart lookahead | `smartFuzzyMatch` |
| Idx family | `idx, itemIdx, queryIdx, chunkFirstIdx, chunkLastIdx, containsIdx, exactContainsIdx` | positions/counters |
| Len family | `queryLen, normalizedItemLen, normalizedQueryLen, chunkLength, minChunkLen, queryCharsLeft, itemCharsLeft` | lengths |
| `SCORE_*` / `CHUNK_*` / `FUZZY_BASE` | named score constants | `shared.ts` |
| `MAX_SAFE_INTEGER` | "no field matched yet" sentinel | `createFuzzySearch` |
| `diacriticsRegex` / `regexŁ` / `regexÑ` | normalization regexes | `normalize.ts` |

## Verbs

| Verb | Meaning | Where |
|---|---|---|
| normalize | fold to canonical form | `normalizeText` |
| match | test/score a string vs a query | `fuzzyMatch`, `matchesFuzzily`, `aggressive`/`smartFuzzyMatch` |
| score | assign numeric quality | `scoreConsecutiveLetters` |
| create | build a searcher | `createFuzzySearch` |
| search | run a query over the collection | the returned closure |
| sort | order results / ranges | `sortByScore`, `sortRangeTuple`, `.sort` |
| startsWith / contains (`indexOf`) | substring tests | `matchesFuzzily`, strategies |
| isValidWordBoundary / isStartOfWord / isEndOfWord | boundary predicates | `shared.ts`, `scoreConsecutiveLetters` |
| preprocess / extract (`getText`·`key`) | precompute per-element data | `createFuzzySearch` |
| split / slice | tokenize / substring | `normalize.ts`, strategies |
| push / every / has / min | accumulate / all-words / membership / minimum | throughout |

## Inconsistencies

Each is a recommendation only; nothing below is applied yet.

- **(a) `item` overloaded** — a single raw field-string (`matchesFuzzily`) vs the whole
  collection element (`FuzzyResult.item`). → Reserve `item` for the element (it's baked
  into the public type); rename the field-string sense to **`field`**.
- **(b) `element` vs `item` vs "result item"** — one concept, three names. → Canonical
  collection-entry term is **`item`** (public, immovable); rename internal `element → item`.
- **(c) `text` vs `item` both mean a raw field-string.** → Canonical searchable-string
  term is **`field`**; public `fuzzyMatch(text, …)` may keep `text` as a documented alias.
- **(d) `Range` reused** for highlight spans and chunk index-pairs. → Introduce an internal
  alias **`type Chunk = Range`** for the fuzzy runs; keep `Range` for highlight spans
  (structurally identical, pure documentation).
- **(e) `indices` local IS a `HighlightRanges`.** → Rename **`indices → chunks`** (`Chunk[]`).
- **(f) `matchesFuzzily` reads like a boolean predicate** but returns `[score, ranges] | null`.
  → **`matchField`** (or `rankField`).
- **(g) `chunkFirstIdx`/`chunkLastIdx`/`firstIdx`/`lastIdx` vs `Range`'s documented `start`/`end`.**
  → Standardize on **`start`/`end`**.
- **(h) `"off"` strategy ≠ "matching off"** — exact/prefix/contains tiers still run; only the
  fuzzy fallback is disabled. Also `fuzzyMatch` hardcodes `"smart"`, so `"off"`/`"aggressive"`
  are unreachable through `fuzzyMatch`. → Document that `strategy` governs **only the fuzzy
  fallback tier**.
- **(i) `Len` (abbrev) vs `chunkLength` (spelled out).** → Standardize on **`Len`**.
- **(j) `matches` is a double-plural** — a per-field list whose entries are themselves range
  lists. → Document as "per-field highlight lists"; consider **`fieldMatches`**.
- **(k) `getText` returns `Array<string | null>`** despite the singular name. → Note canonical
  intent **`getFields`**/`getTexts` (public — would need a compat shim to change).
- **(l) `preprocessed` vs `processed`** differ only by prefix, easy to confuse. → Rename inner
  **`processed → fields`**.
- **(m) `normalizedItem` / `normalizedText` / `normalized`** — three names for one thing. →
  Canonical **`normalizedField`**.
- **(n) `queryChar: string` can be `undefined`** once `queryIdx` runs past the query end (the
  code relies on the coercion in `indexOf`). → Type-honesty note; behavior is fine, leave the code.
- **(o) `sortByScore` (by-what) vs `sortRangeTuple` (of-what)** — mismatched naming scheme. →
  Rename **`sortRangeTuple → sortByRangeStart`** for a parallel `sortBy…` scheme.

## Canonical glossary (target vocabulary)

- **`item`** — a collection entry (public, via `FuzzyResult.item`).
- **`field`** — one raw searchable string extracted from an item.
- **`normalizedField`** — a field after `normalizeText`.
- **`chunk`** (`type Chunk = Range`) — a consecutive run of matched characters.
- **`Range`** — a highlight span `[start, end]`, inclusive.
- **`matches`** — per-field highlight lists.
- **`matchField`** — rank one field against a query.
- **`start` / `end`** — the bounds of a range or chunk.
- **`SMART_MIN_CHUNK`** — the smart strategy's minimum mid-word lookahead width (the `3` in
  `Math.min(3, …)`).
