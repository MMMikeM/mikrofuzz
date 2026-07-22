# Performance notes & exploration

**Status:** exploration, not committed. Recorded so we don't re-derive it. Nothing
here is on the roadmap yet; it's the analysis behind "should krino index its corpus?"

## The question: a trie index?

On an early **combinatorial** benchmark corpus (`ADJ × NOUN × SUFFIX`), `fast-fuzzy`
benchmarked ~4× faster than krino *while doing typo-tolerant edit-distance matching*.
That looked paradoxical — edit distance is expensive per pair. The trick is
structural, not algorithmic:

1. **Trie index.** `new Searcher(list)` inserts every candidate's normalized key
   into a trie. Shared prefixes are stored — and scored — once.
2. **Threshold-pruned DFS.** It walks the trie running a bounded Sellers /
   Damerau-Levenshtein DP. At each node it computes the *best score any string in
   this subtree could reach*; if that can't clear `threshold` (default 0.6), it
   prunes the whole subtree. Most candidates are never scored.
3. **Rolling DP rows.** Two rows extended along trie edges, so a shared prefix's
   DP cells are computed once for everything beneath it.

So fast-fuzzy is fast **because it indexes + prunes**, not because typos are cheap —
and that speed is **entirely corpus-dependent**. Its pruning only skips subtrees
when candidates share prefixes. When the benchmark corpus was switched to seeded
**faker** data (natural-language product / company / person / place names, far less
shared-prefix structure), fast-fuzzy fell from ~4× faster than krino to **~4–9×
slower** — among the slowest in the set. The trie's whole advantage evaporated with
the corpus shape. (For contrast, Fuse.js is also typo-tolerant and consistently the
slowest here. "Typo-tolerant" says nothing about speed; the data structure and the
corpus do.)

krino, by comparison, does **zero corpus indexing**. `createFuzzySearch` caches
per-field normalization and word splits, but each query then linearly scans *every*
item through the whole tier ladder (exact → prefix → boundary → multi-word →
contains → acronym → fuzzy). O(N) full passes with a fat per-item constant and no
pruning.

## Why a prefix trie is a poor fit for krino specifically

A trie accelerates **prefix** and **exact** lookups. Those are already krino's
cheapest tiers (`startsWith`, `===`). krino's *expensive* tiers match **mid-string
and out-of-order**:

- `boundary` / `contains` — the query can sit anywhere in the field.
- `multi-word` — all query words present in any order.
- `fuzzy` — a subsequence chain scattered across the field.

A prefix trie helps none of these. Worse, fast-fuzzy's pruning relies on a **single
scalar threshold** to cut subtrees. krino has no such cutoff: it's a *tier ladder*
that returns **every** item that matches at any tier, ranked — there's no "score
below X, skip it" to prune on. So the exact mechanism that makes fast-fuzzy's trie
pay off doesn't transfer.

## What would actually help (if we ever target scale)

krino's README already punts on huge corpora ("for 100k+ prefer uFuzzy /
fuzzysort"). If we ever wanted to compete there, the right structures are **not** a
prefix trie:

- **Inverted token index** (`word → items`). Turns the multi-word and
  boundary tiers into posting-list intersections instead of an N-item scan. The
  biggest single lever for those tiers.
- **Trigram (n-gram) index** (`3-gram → items`). Gate the fuzzy/contains tiers by
  shared trigrams *before* the per-item regex subsequence test — prunes the fuzzy
  tier the way the L1 regex gate does, but without visiting every item first.
- **Suffix automaton / suffix array** for arbitrary-substring `contains`. Powerful
  but heavy; likely overkill.

### Costs / tensions

- **Bundle size.** krino is ~1.8 kB. A real index could double that — directly
  against the "tiny" pitch.
- **Build time + memory.** Index construction (currently ~1–6 ms for 2k–10k) and
  posting-list storage grow with the corpus. Only worth it when N is large.
- **API model.** Any index must live inside `createFuzzySearch` (the stateful,
  cached entry point). The `fuzzyMatch` **primitive must stay stateless** — that's
  the whole point of the primitive-first design. An index that leaked into the
  primitive would break composition.
- **Scope.** At 2k items krino is already <0.2 ms/query; at 10k, ~0.6 ms. Indexing
  buys nothing until the corpus is much bigger than krino's stated target use
  (command palettes, pickers, autocomplete over lists you already hold).

## Cheaper wins

Before any index, the linear scan itself has slack — these keep the current model
and the tiny bundle.

### Front-of-ladder pre-filter — DONE (per query type)

Inspired by uFuzzy, whose speed comes from a single native regex that rejects
non-candidates before any ranking work. krino now does the same at the **front** of
the tier ladder — one native regex that, on failure, skips the whole ladder — with
the gate chosen by query type:

- **Multi-word queries → order-independent presence gate** (`buildPresenceGate`,
  `^(?=[^]*a)(?=[^]*b)…`): asserts every distinct query char is present, in any
  order. This is mandatory here — krino's multi-word tier matches words out of
  order, so uFuzzy's subsequence gate would wrongly reject `"foo bar"` against
  `"bar … foo"`. (Pinned by `bench/correctness.test.ts`.)
- **Single-word queries → subsequence gate** (`buildFuzzyGate`, `a[^]*b[^]*c`): with
  one word there's no out-of-order concern, so every tier needs the query's chars
  *in order*. This gate is both **stricter** (rejects more) and **cheaper** (one
  pass vs the presence gate's k lookaheads).

Both are valid necessary conditions for their query type, so no true match is ever
dropped — all tests stay green.

Measured (seeded faker corpus), original → presence-only → per-type:

| size | no gate | presence gate | per-type gate |
| ---- | ------- | ------------- | ------------- |
| 1k   | 0.093ms | 0.097ms       | **0.073ms**   |
| 10k  | 0.978ms | 0.969ms       | **0.722ms**   |
| 100k | 19.998ms| 11.774ms      | **8.944ms**   |

Net **~2.2× faster at 100k and ~25% at 1k/10k** over the original. The per-type
split also erased the small-corpus regression the always-presence gate caused (its
k-lookahead cost wasn't offset when little is skipped). krino now beats its parent
`@nozbe/microfuzz` at every size.

Residual gap to uFuzzy (~3–4× at scale) is fundamental: even with the same filter
idea, krino's survivors run the full JS tier ladder and build a `tier` + per-char
`ranges` + score, and its multi-word gate is the weaker order-independent kind.
krino trades that speed for richer, safer semantics.

### Still on the table

- **Hoist allocations out of the ladder** — reuse arrays, avoid rebuilding word
  lists / regexes per item where the query (not the item) determines them.
- **Short-circuit ordering** — cheapest, most-selective tiers first (already
  roughly the case).

## Verdict

**Defer.** A prefix trie is the wrong tool for krino's tier model. Genuine scaling
would come from an inverted-token + trigram index, but that fights the tiny/simple
positioning and only pays off well past krino's target corpus size. Revisit only if
krino deliberately expands to 100k+ corpora; until then, the cheaper scan-level wins
above are the better use of bytes.

## Benchmark caveat (resolved)

The original `bench/compare.bench.ts` built its corpus combinatorially
(`ADJ × NOUN × SUFFIX`), producing **heavy shared prefixes** — ideal conditions for
a trie-based lib like fast-fuzzy. That was fixed: the bench now generates a seeded
**faker** corpus (product / company / person / place names) at 1k / 10k / 100k, which
shares far fewer prefixes. The switch flipped fast-fuzzy from fastest-ish to among
the slowest — concrete proof that corpus shape, not just algorithm, drives these
numbers. Takeaway for any future benchmark: state the corpus, and prefer
natural-language data over word-grids unless prefix-clustering is what you mean to
measure.
