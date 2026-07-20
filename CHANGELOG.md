# Changelog

## 1.0.0

A primitive-first redesign. The library is now a rich single-string matcher
(`fuzzyMatch`) plus a thin, cached collection search (`createFuzzySearch`) built on
it — instead of one function with a growing options bag.

### Breaking

- **`fuzzyMatch(text, query, options?)`** returns **`{ score, tier, ranges }`** (or
  `null`) — was `{ item, score, matches, scores }`. `ranges` is the field's
  `HighlightRanges` directly (no per-field wrapper array). Adds `options`
  (`{ strategy?, acronym? }`).
- **`createFuzzySearch`** second arg is a **`getText` function** or an **array of
  field specs** — the `{ key, getText, strategy, acronym, fields }` options object is
  gone. `key` (stringly property name) is **removed** — use `(item) => item.name`.
- **Result shape** is `{ item, score, fields: Array<MatchResult | null> }` — the
  parallel `matches` and `scores` arrays are replaced by one `fields` array of
  `{ score, tier, ranges }`.
- New **`tier`** on every match: a categorical name (`"exact"` … `"fuzzy"`) alongside
  the numeric score.
- `getText` returns a single string per field (was `Array<string | null>`); use
  multiple field specs for multiple fields.

### Added

- **`tier`** categorical match kind; **`Tier`** type.
- **`fuzzyMatch` options** — per-call `strategy` and `acronym`.
- **Per-field specs** with `strategy` / `acronym` / `penalty` (demote-only).
- **`splitWords`** exported; **`SCORES`** exported; **`matchDensity`** helper.
- Generic inference — `getText` / `FieldSpec<T>` are typed to the item, no cast.

### Fixed (carried from the bug-fix pass)

- Punctuation (`. , : ; /`) is a word boundary; words tokenize on any non-alphanumeric run.
- Boundary-contains scans past mid-word occurrences; highlights land on the standalone word.
- Multi-word tier is a flat `1.5` (more words no longer ranks worse).
- Empty query → `null` / `[]`.
- Highlight width uses the normalized query length.

### Performance

- Native regex subsequence gate on the fuzzy tier (`buildFuzzyGate`): ~2× faster
  query throughput on fuzzy-heavy workloads, behavior-identical.

## 0.1.0

Initial release: zero-dependency fuzzy search with smart word-boundary matching.
