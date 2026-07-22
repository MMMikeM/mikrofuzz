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
 * - CORPUS: real-ish names from faker (product / company / person / place),
 *   seeded for reproducibility. Natural-language names share far fewer prefixes
 *   than a combinatorial word-grid, so they don't flatter trie-based libs
 *   (fast-fuzzy). Corpus shape still moves the numbers — don't read them as
 *   universal.
 * The point is positioning, not a leaderboard. Run: `pnpm bench`.
 */
import { faker } from "@faker-js/faker";
import uFuzzy from "@leeoniya/ufuzzy";
import createMicrofuzz from "@nozbe/microfuzz";
import { Searcher } from "fast-fuzzy";
import Fuse from "fuse.js";
import { filter as fuzzyFilter } from "fuzzy";
import fuzzysort from "fuzzysort";
import { matchSorter } from "match-sorter";
import { bench, describe } from "vitest";
import { createFuzzySearch } from "krino";

const GENERATORS: Array<() => string> = [
	() => faker.commerce.productName(),
	() => faker.company.name(),
	() => faker.person.fullName(),
	() => `${faker.location.city()}, ${faker.location.country()}`,
];

// Reseed before every build so corpora are nested (1k ⊂ 10k ⊂ 100k) and the
// queries below (derived from a 2k sample) hit at every size.
const build = (n: number): string[] => {
	faker.seed(20240607);
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(GENERATORS[i % GENERATORS.length]());
	return out;
};

const wordsOf = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const everyOther = (w: string): string => [...w].filter((_, k) => k % 2 === 0).join("");

// Queries derived from a fixed sample so they actually match: a real word, a
// second word, a two-word phrase, a raw prefix, a scattered subsequence (fuzzy
// tier), and one guaranteed miss (reject path).
const sample = build(2000);
const word = (i: number): string => wordsOf(sample[i])[0] ?? "steel";
const QUERIES: string[] = [
	word(4).toLowerCase(),
	word(517).toLowerCase(),
	wordsOf(sample[8]).slice(0, 2).join(" ").toLowerCase(),
	sample[42].slice(0, 5).toLowerCase(),
	everyOther(word(1300)).toLowerCase(),
	"qxzwkv",
];

// Bound the slow libs at 100k (Fuse/match-sorter run tens of ms per query) while
// still collecting many samples for the fast ones.
const BENCH_OPTS = { time: 300, iterations: 5, warmupTime: 100, warmupIterations: 1 };

for (const size of [1000, 10000, 100000]) {
	const list = build(size);
	const mikro = createFuzzySearch(list); // prebuilt index
	const microfuzz = createMicrofuzz(list); // prebuilt index (the parent lib)
	const fastFuzzy = new Searcher(list); // prebuilt index
	const fuse = new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
	const uf = new uFuzzy();

	describe(`query ${size} items × ${QUERIES.length} queries`, () => {
		bench("krino", () => {
			for (const q of QUERIES) mikro(q);
		}, BENCH_OPTS);
		bench("@nozbe/microfuzz", () => {
			for (const q of QUERIES) microfuzz(q);
		}, BENCH_OPTS);
		bench("fuzzy", () => {
			for (const q of QUERIES) fuzzyFilter(q, list);
		}, BENCH_OPTS);
		bench("fuzzysort", () => {
			for (const q of QUERIES) fuzzysort.go(q, list);
		}, BENCH_OPTS);
		bench("match-sorter", () => {
			for (const q of QUERIES) matchSorter(list, q);
		}, BENCH_OPTS);
		bench("fast-fuzzy", () => {
			for (const q of QUERIES) fastFuzzy.search(q);
		}, BENCH_OPTS);
		bench("uFuzzy", () => {
			for (const q of QUERIES) uf.search(list, q);
		}, BENCH_OPTS);
		bench("fuse.js", () => {
			for (const q of QUERIES) fuse.search(q);
		}, BENCH_OPTS);
	});

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
