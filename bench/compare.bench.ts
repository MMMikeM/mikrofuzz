/**
 * Cross-library comparison. Fair-task caveats:
 * - Fuse.js does typo-tolerant Bitap matching (a capability the others lack),
 *   so it does more work per query — not an apples-to-apples speed contest.
 * - uFuzzy / match-sorter keep no persistent index, so their full cost is inside
 *   the query loop; mikrofuzz and Fuse prebuild an index once (setup).
 * The point is positioning, not a leaderboard. Run: `pnpm bench`.
 */
import uFuzzy from "@leeoniya/ufuzzy";
import Fuse from "fuse.js";
import { matchSorter } from "match-sorter";
import { bench, describe } from "vitest";
import { createFuzzySearch } from "@mmmike/mikrofuzz";

const ADJ = [
	"fast", "smart", "async", "fuzzy", "tiny", "deep", "zero", "hyper",
	"micro", "modern", "secure", "native", "lazy", "eager", "atomic",
];
const NOUN = [
	"search", "parser", "router", "cache", "stream", "buffer", "token",
	"matcher", "engine", "index", "query", "filter", "loop", "kernel", "module",
];
const SUFFIX = ["js", "core", "kit", "lib", "pro", "x", "next", "hub"];

const build = (n: number): string[] => {
	const out: string[] = [];
	for (let i = 0; out.length < n; i++) {
		const a = ADJ[i % ADJ.length];
		const nn = NOUN[(i * 7) % NOUN.length];
		const s = SUFFIX[(i * 13) % SUFFIX.length];
		out.push(`${a} ${nn} ${s}`);
	}
	return out;
};

// prefix, common word, multi-word, and two sparse/fuzzy needles
const QUERIES = ["fuzz", "search", "async engine", "tknmatchr", "smart cache", "modidx"];

for (const size of [2000, 10000]) {
	const list = build(size);
	const mikro = createFuzzySearch(list);
	const fuse = new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
	const uf = new uFuzzy();

	describe(`query ${size} items × ${QUERIES.length} queries`, () => {
		bench("mikrofuzz", () => {
			for (const q of QUERIES) mikro(q);
		});
		bench("match-sorter", () => {
			for (const q of QUERIES) matchSorter(list, q);
		});
		bench("uFuzzy", () => {
			for (const q of QUERIES) uf.search(list, q);
		});
		bench("fuse.js", () => {
			for (const q of QUERIES) fuse.search(q);
		});
	});

	describe(`build index (${size} items)`, () => {
		bench("mikrofuzz createFuzzySearch", () => {
			createFuzzySearch(list);
		});
		bench("fuse.js new Fuse", () => {
			new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
		});
	});
}
