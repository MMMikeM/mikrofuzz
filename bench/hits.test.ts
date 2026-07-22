/**
 * Match-count + rank validity: the speed benches time work but never check the
 * work produced results. Every query knows the corpus item it was derived from
 * (corpus.ts `source`), so this runs every benched configuration once per
 * corpus and query and records:
 * - how many items matched (making "fast because it does less" concrete — the
 *   Pass column in docs/benchmarks.md),
 * - where the source item ranked in the library's ordering (`@1` = top hit,
 *   `✗` = matched things but not the item the query came from), and
 * - a per-query time (time-boxed mean of the raw search call — magnitude, not
 *   the rigorous vitest-bench numbers).
 */
import uFuzzy from "@leeoniya/ufuzzy";
import createMicrofuzz from "@nozbe/microfuzz";
import { Searcher } from "fast-fuzzy";
import Fuse from "fuse.js";
import { filter as fuzzyFilter } from "fuzzy";
import fuzzysort from "fuzzysort";
import { matchSorter } from "match-sorter";
import { describe, expect, it } from "vitest";
import { createFuzzySearch } from "krino";
import { CORPORA } from "./corpus";

const SIZE = 10_000;

type Outcome = { count: number; rank: number | null };
type Runner = (query: string, source: string | null) => Outcome;

const outcome = (ranked: string[], source: string | null): Outcome => ({
	count: ranked.length,
	rank: source == null ? null : ranked.indexOf(source) + 1 || null,
});

const cell = ({ count, rank }: Outcome, source: string | null): string => {
	if (source == null || count === 0) return `${count}`;
	return rank == null ? `${count} ✗` : `${count} @${rank}`;
};

const fmtMs = (ms: number): string => ms.toFixed(2);

// Consumed by every timed call so the JIT can't dead-code-eliminate the work.
let sink = 0;

// Time-boxed mean of one call: warm up, then sample for ~50 ms.
const timeQuery = (run: () => number): number => {
	for (let i = 0; i < 3; i++) sink += run();
	const start = performance.now();
	let iterations = 0;
	do {
		sink += run();
		iterations++;
	} while (performance.now() - start < 50);
	return (performance.now() - start) / iterations;
};

describe("bench validity: per-library match counts and source rank", () => {
	for (const { name, build, specs } of CORPORA) {
		// The per-cell timing loops (~50 ms × 11 libs × 9 queries) outgrow the
		// default 5 s test timeout.
		it(`[${name}] every library matches the plain-word query`, { timeout: 30_000 }, () => {
			const list = build(SIZE);
			const uf = new uFuzzy();
			const latinized = uFuzzy.latinize(list);
			const krino = createFuzzySearch(list);
			const krinoAggressive = createFuzzySearch(list, [
				{ text: (x: string) => x, strategy: "aggressive" },
			]);
			const microfuzz = createMicrofuzz(list);
			const fastFuzzy = new Searcher(list);
			const fuse = new Fuse(list, { ignoreLocation: true, threshold: 0.4 });
			const fuseAll = new Fuse(list, {
				ignoreLocation: true,
				threshold: 0.4,
				ignoreDiacritics: true,
				includeMatches: true,
				useExtendedSearch: true,
			});

			// uFuzzy's ranked order needs search() info; it's null above the
			// info threshold, where only the count survives.
			const uFuzzyRun = (haystack: string[], needle: string, source: string | null): Outcome => {
				const [idxs, info, order] = uf.search(haystack, needle);
				if (!idxs?.length) return { count: 0, rank: null };
				if (!info || !order) return { count: idxs.length, rank: null };
				const ranked = order.map((o) => list[info.idx[o]]);
				return outcome(ranked, source);
			};

			const runners: Record<string, Runner> = {
				krino: (q, src) => outcome(krino(q).map((r) => r.item), src),
				"krino (aggressive)": (q, src) => outcome(krinoAggressive(q).map((r) => r.item), src),
				"@nozbe/microfuzz": (q, src) =>
					outcome(
						microfuzz(q)
							.sort((a, b) => a.score - b.score)
							.map((r) => r.item),
						src,
					),
				fuzzysort: (q, src) => outcome(fuzzysort.go(q, list).map((r) => r.target), src),
				"match-sorter": (q, src) => outcome(matchSorter(list, q), src),
				"fast-fuzzy": (q, src) => outcome(fastFuzzy.search(q), src),
				uFuzzy: (q, src) => uFuzzyRun(list, q, src),
				"uFuzzy (latinize)": (q, src) => uFuzzyRun(latinized, uFuzzy.latinize([q])[0], src),
				"fuse.js": (q, src) => outcome(fuse.search(q).map((r) => r.item), src),
				"fuse.js (all opts)": (q, src) => outcome(fuseAll.search(q).map((r) => r.item), src),
				fuzzy: (q, src) => outcome(fuzzyFilter(q, list).map((r) => r.original ?? r.string), src),
			};

			// Raw search calls only — no rank extraction or sorting overhead —
			// mirroring what the vitest benches time.
			const timers: Record<string, (q: string) => number> = {
				krino: (q) => krino(q).length,
				"krino (aggressive)": (q) => krinoAggressive(q).length,
				"@nozbe/microfuzz": (q) => microfuzz(q).length,
				fuzzysort: (q) => fuzzysort.go(q, list).length,
				"match-sorter": (q) => matchSorter(list, q).length,
				"fast-fuzzy": (q) => fastFuzzy.search(q).length,
				uFuzzy: (q) => uf.search(list, q)[0]?.length ?? 0,
				"uFuzzy (latinize)": (q) => uf.search(latinized, uFuzzy.latinize([q])[0])[0]?.length ?? 0,
				"fuse.js": (q) => fuse.search(q).length,
				"fuse.js (all opts)": (q) => fuseAll.search(q).length,
				fuzzy: (q) => fuzzyFilter(q, list).length,
			};

			// One full warm pass over every lib × query before any timing —
			// early cells otherwise pay the whole process's JIT warmup.
			for (const warm of Object.values(timers)) {
				for (const { query } of specs) sink += warm(query);
			}

			// Per-lib aggregates: reciprocal ranks (miss = 0) and match counts
			// over the scored queries, time over every query.
			const scores: Record<string, { rrs: number[]; counts: number[]; times: number[] }> = {};

			const rows = specs.map(({ query, kind, source }) => {
				const row: Record<string, string> = { kind, query };
				for (const [lib, run] of Object.entries(runners)) {
					const ms = timeQuery(() => timers[lib](query));
					const { count, rank } = run(query, source);
					const s = (scores[lib] ??= { rrs: [], counts: [], times: [] });
					s.times.push(ms);
					if (source != null) {
						s.rrs.push(rank ? 1 / rank : 0);
						s.counts.push(count);
					}
					row[lib] = `${cell({ count, rank }, source)} ${fmtMs(ms)}ms`;
				}
				return row;
			});
			console.table(rows);

			// Scorecard: MRR (mean reciprocal rank — the principled "average
			// rank": bounded, no imputation for misses, deep ranks self-dampen)
			// beside its mandatory companion, median matches — MRR alone crowns
			// whoever returns everything.
			const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
			const median = (xs: number[]): number => {
				const sorted = [...xs].sort((a, b) => a - b);
				const mid = sorted.length / 2;
				return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
			};
			console.table(
				Object.entries(scores)
					.map(([library, s]) => ({
						library,
						MRR: mean(s.rrs).toFixed(2),
						"median matches": Math.round(median(s.counts)),
						"mean ms": `${mean(s.times).toFixed(2)}ms`,
					}))
					.sort((a, b) => Number(b.MRR) - Number(a.MRR)),
			);

			// Every benched lib must find something for a plain corpus word —
			// otherwise its speed numbers time a no-op.
			const plainWord = specs[0];
			for (const [lib, run] of Object.entries(runners)) {
				expect(
					run(plainWord.query, plainWord.source).count,
					`${lib} found nothing for "${plainWord.query}"`,
				).toBeGreaterThan(0);
			}

			for (const { query, kind, source } of specs) {
				const { count, rank } = runners.krino(query, source);
				if (kind === "miss") {
					expect(count, `krino matched garbage "${query}"`).toBe(0);
				} else if (!kind.startsWith("scatter")) {
					// krino must surface the item each query was derived from.
					// (scatter kinds exempt: they probe where smart chunking
					// legitimately gives up — that limit is the measurement.)
					expect(rank, `krino lost source of "${query}" (${kind})`).not.toBeNull();
				}
			}

			// Folding configs must find at least as much as their non-folding
			// base on the accent probe (quantifies the README's †).
			const accentProbe = specs.find((s) => s.kind === "accent-stripped");
			if (accentProbe) {
				const { query, source } = accentProbe;
				expect(runners.krino(query, source).count).toBeGreaterThan(0);
				expect(runners["uFuzzy (latinize)"](query, source).count).toBeGreaterThanOrEqual(
					runners.uFuzzy(query, source).count,
				);
				expect(runners["fuse.js (all opts)"](query, source).count).toBeGreaterThanOrEqual(
					runners["fuse.js"](query, source).count,
				);
			}
		});
	}
});
