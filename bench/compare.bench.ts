/**
 * Cross-library comparison. Fair-task caveats:
 * - Fuse.js and fast-fuzzy do typo-tolerant matching (Bitap / edit-distance —
 *   a capability the others lack), so they do more work per query — not an
 *   apples-to-apples speed contest.
 * - uFuzzy / match-sorter / fuzzysort / fuzzy keep no persistent index, so their
 *   full cost is inside the query loop; krino, @nozbe/microfuzz, fast-fuzzy and
 *   Fuse prebuild an index once (setup).
 * - fuzzy (mattyork) is a plain substring highlighter (no tiers/typos), included
 *   as the tiny-but-limited floor.
 * - CORPORA: two seeded faker corpora (see corpus.ts) — `ascii` (en only) and
 *   `mixed` (~5% diacritics), benched separately so diacritic cost is visible.
 *   Natural-language names share far fewer prefixes than a combinatorial
 *   word-grid, so they don't flatter trie-based libs (fast-fuzzy). Corpus shape
 *   still moves the numbers — don't read them as universal.
 * - Each lib with optional features gets a second "(all opts)" line: every
 *   opt-in switched on (diacritic folding, multi-word, ranges/highlight
 *   output) EXCEPT typo modes — krino can't reciprocate, so typo tolerance
 *   stays off everywhere. Base lines are stock defaults.
 * The point is positioning, not a leaderboard. Run: `pnpm bench`.
 */
import uFuzzy from "@leeoniya/ufuzzy";
import createMicrofuzz from "@nozbe/microfuzz";
import { Searcher } from "fast-fuzzy";
import Fuse from "fuse.js";
import { filter as fuzzyFilter } from "fuzzy";
import fuzzysort from "fuzzysort";
import { matchSorter } from "match-sorter";
import { bench, describe } from "vitest";
import { createFuzzySearch } from "krino";
import { CORPORA } from "./corpus";

// Bound the slow libs at 100k (Fuse/match-sorter run tens of ms per query) while
// still collecting many samples for the fast ones.
const BENCH_OPTS = { time: 300, iterations: 5, warmupTime: 100, warmupIterations: 1 };

// Every bench consumes its result into this sink so the JIT can't dead-code
// eliminate result construction. Match-count VALIDITY lives in hits.test.ts.
let sink = 0;

for (const { name: corpusName, build, queries: QUERIES } of CORPORA)
for (const size of [1000, 10000, 100000]) {
	const list = build(size);
	const mikro = createFuzzySearch(list); // prebuilt index
	const microfuzz = createMicrofuzz(list); // prebuilt index (the parent lib)
	const fastFuzzy = new Searcher(list); // prebuilt index
	const fuse = new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
	const uf = new uFuzzy();

	// "(all opts)" variants — every opt-in on except typo modes. Cached prep
	// (latinized haystack, prebuilt indexes) stays outside the query loop, same
	// as the base lines.
	const mikroAll = createFuzzySearch(list, [{ text: (x: string) => x, acronym: true }]);
	const microfuzzAll = createMicrofuzz(list, { strategy: "aggressive" });
	const fastFuzzyAll = new Searcher(list, { returnMatchData: true });
	const fuseAll = new Fuse(list, {
		ignoreLocation: true,
		threshold: 0.4,
		ignoreDiacritics: true,
		includeMatches: true,
		useExtendedSearch: true,
	});
	const latinized = uFuzzy.latinize(list);
	const OUT_OF_ORDER = 1;

	describe(`[${corpusName}] query ${size} items × ${QUERIES.length} queries`, () => {
		bench("krino", () => {
			for (const q of QUERIES) sink += mikro(q).length;
		}, BENCH_OPTS);
		bench("krino (all opts)", () => {
			for (const q of QUERIES) sink += mikroAll(q).length;
		}, BENCH_OPTS);
		bench("@nozbe/microfuzz", () => {
			for (const q of QUERIES) sink += microfuzz(q).length;
		}, BENCH_OPTS);
		bench("@nozbe/microfuzz (all opts)", () => {
			for (const q of QUERIES) sink += microfuzzAll(q).length;
		}, BENCH_OPTS);
		bench("fuzzy", () => {
			for (const q of QUERIES) sink += fuzzyFilter(q, list).length;
		}, BENCH_OPTS);
		bench("fuzzy (all opts)", () => {
			for (const q of QUERIES) sink += fuzzyFilter(q, list, { pre: "<", post: ">" }).length;
		}, BENCH_OPTS);
		bench("fuzzysort", () => {
			for (const q of QUERIES) sink += fuzzysort.go(q, list).length;
		}, BENCH_OPTS);
		bench("match-sorter", () => {
			for (const q of QUERIES) sink += matchSorter(list, q).length;
		}, BENCH_OPTS);
		bench("fast-fuzzy", () => {
			for (const q of QUERIES) sink += fastFuzzy.search(q).length;
		}, BENCH_OPTS);
		bench("fast-fuzzy (all opts)", () => {
			for (const q of QUERIES) sink += fastFuzzyAll.search(q).length;
		}, BENCH_OPTS);
		bench("uFuzzy", () => {
			for (const q of QUERIES) sink += uf.search(list, q)[0]?.length ?? 0;
		}, BENCH_OPTS);
		bench("uFuzzy (all opts)", () => {
			for (const q of QUERIES)
				sink += uf.search(latinized, uFuzzy.latinize([q])[0], OUT_OF_ORDER)[0]?.length ?? 0;
		}, BENCH_OPTS);
		bench("fuse.js", () => {
			for (const q of QUERIES) sink += fuse.search(q).length;
		}, BENCH_OPTS);
		bench("fuse.js (all opts)", () => {
			for (const q of QUERIES) sink += fuseAll.search(q).length;
		}, BENCH_OPTS);
	});

	// Build cost barely differs between corpora — measure it once, on mixed.
	if (corpusName === "mixed") {
		describe(`build index (${size} items)`, () => {
			bench("krino createFuzzySearch", () => {
				createFuzzySearch(list);
			}, BENCH_OPTS);
			bench("@nozbe/microfuzz", () => {
				createMicrofuzz(list);
			}, BENCH_OPTS);
			bench("fast-fuzzy new Searcher", () => {
				new Searcher(list);
			}, BENCH_OPTS);
			bench("fuse.js new Fuse", () => {
				new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
			}, BENCH_OPTS);
		});
	}
}
