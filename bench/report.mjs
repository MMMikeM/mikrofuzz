/**
 * Summarize the raw vitest bench output (results.json) into a single comparison
 * table + comparison.json. Keeps the noisy per-size detail in JSON; the README
 * shows only the averaged, krino-relative view.
 *
 *   pnpm bench            # regenerates results.json
 *   node report.mjs       # -> comparison.json + printed markdown table
 *
 * `perf` is per-query time relative to krino, averaged over the workloads
 * (krino = 100%, lower = faster). `type` is the class of search — cross-type
 * rows are not apples-to-apples (typo-tolerant libs do more work; substring
 * libs do less).
 */
import { readFileSync, writeFileSync } from "node:fs";

// Static per-lib metadata. Sizes measured uniformly:
//   esbuild --bundle --minify (tree-shaken to the primary API) | gzip
// `features` verified against each lib's current source (see README table):
//   yes = built-in/default, "opt-in", "partial", no. `updated` = last npm publish.
const META = {
	krino: {
		gzipKB: 1.9, deps: 0, type: "subsequence (tiered)", module: "esm", updated: null,
		features: { ranges: "yes", tier: "yes", diacritics: "yes", multiWord: "yes", perField: "yes", typos: "no" },
	},
	"@nozbe/microfuzz": {
		gzipKB: 1.7, deps: 0, type: "subsequence", module: "cjs", updated: "2023-07-18",
		features: { ranges: "yes", tier: "no", diacritics: "yes", multiWord: "yes", perField: "yes", typos: "no" },
	},
	fuzzysort: {
		gzipKB: 3.7, deps: 0, type: "subsequence", module: "cjs", updated: "2024-10-14",
		features: { ranges: "yes", tier: "no", diacritics: "yes", multiWord: "yes", perField: "yes", typos: "no" },
	},
	"match-sorter": {
		gzipKB: 3.4, deps: 2, type: "subsequence (tiered)", module: "dual", updated: "2026-04-15",
		features: { ranges: "no", tier: "yes", diacritics: "yes", multiWord: "no", perField: "yes", typos: "no" },
	},
	uFuzzy: {
		gzipKB: 4.1, deps: 0, type: "subsequence", module: "dual", updated: "2025-08-22",
		features: { ranges: "yes", tier: "no", diacritics: "opt-in", multiWord: "opt-in", perField: "no", typos: "opt-in" },
	},
	fuzzy: {
		gzipKB: 0.8, deps: 0, type: "substring", module: "cjs", updated: "2016-10-01",
		features: { ranges: "partial", tier: "no", diacritics: "no", multiWord: "no", perField: "no", typos: "no" },
	},
	"fuse.js": {
		gzipKB: 9.3, deps: 0, type: "typo-tolerant", module: "dual", updated: "2026-07-13",
		features: { ranges: "opt-in", tier: "no", diacritics: "opt-in", multiWord: "opt-in", perField: "yes", typos: "yes" },
	},
	"fast-fuzzy": {
		gzipKB: 11, deps: 1, type: "typo-tolerant", module: "dual", updated: "2022-11-05",
		features: { ranges: "partial", tier: "no", diacritics: "no", multiWord: "no", perField: "yes", typos: "yes" },
	},
};

const QUERIES_PER_ITER = 6; // compare.bench.ts loops this many queries per sample

const raw = JSON.parse(readFileSync(new URL("./results.json", import.meta.url)));

// Collect per-query mean (ms) for each lib at each list size, from "query" groups.
const perQuery = {}; // name -> { [size]: ms }
for (const file of raw.files ?? []) {
	for (const group of file.groups ?? []) {
		const label = group.fullName ?? group.name ?? "";
		const m = label.match(/query (\d+) items/);
		if (!m) continue;
		const size = m[1];
		for (const b of group.benchmarks ?? []) {
			(perQuery[b.name] ??= {})[size] = b.mean / QUERIES_PER_ITER;
		}
	}
}

const sizes = [...new Set(Object.values(perQuery).flatMap((s) => Object.keys(s)))].sort(
	(a, b) => Number(a) - Number(b),
);

const base = perQuery.krino;
if (!base) throw new Error("no 'krino' row in results.json — run `pnpm bench` first");

// Group order: krino's class first, then the different-task classes. Within a
// group, sort by size (krino's axis) so peers read as a block, not a speed race.
const GROUP_RANK = { subsequence: 0, "typo-tolerant": 1, substring: 2 };
const groupRank = (type) => GROUP_RANK[type.replace(/ \(.*\)$/, "")] ?? 9;

const libraries = Object.entries(perQuery)
	.map(([name, bySize]) => {
		const meta = META[name] ?? { gzipKB: null, deps: null, type: "?" };
		const relToKrino = {};
		for (const size of sizes) {
			if (bySize[size] != null && base[size] != null) relToKrino[size] = bySize[size] / base[size];
		}
		const rels = Object.values(relToKrino);
		const meanRel = rels.reduce((a, b) => a + b, 0) / rels.length;
		return {
			name,
			gzipKB: meta.gzipKB,
			deps: meta.deps,
			type: meta.type,
			module: meta.module,
			updated: meta.updated,
			features: meta.features,
			perQueryMs: bySize,
			relToKrino,
			meanRelPct: Math.round(meanRel * 100),
		};
	})
	.sort((a, b) => groupRank(a.type) - groupRank(b.type) || a.gzipKB - b.gzipKB);

const out = {
	method: {
		size: "esbuild --bundle --minify (tree-shaken to primary API) | gzip",
		speed: "vitest bench, per-query mean over workloads; perf = time relative to krino (100%), lower is faster",
		workloads: sizes.map(Number),
		queriesPerIter: QUERIES_PER_ITER,
	},
	libraries,
};
writeFileSync(new URL("./comparison.json", import.meta.url), `${JSON.stringify(out, null, 2)}\n`);

// Print the README table — one krino-relative perf column per list size.
const fmtSize = (s) => (Number(s) >= 1000 ? `${Number(s) / 1000}k` : `${s}`);
const perfCell = (l, size) => {
	const r = l.relToKrino[String(size)];
	if (r == null) return "—";
	const pct = `${Math.round(r * 100)}%`;
	return l.name === "krino" ? `**${pct}**` : pct;
};

const header = ["#", "Library", "Gzip", "Deps", ...sizes.map(fmtSize), "Type"];
const rows = libraries.map((l, i) => {
	const gz = l.gzipKB == null ? "?" : `~${l.gzipKB} kB`;
	const nm = l.name === "krino" ? "**krino**" : l.name;
	const perf = sizes.map((s) => perfCell(l, s)).join(" | ");
	return `| ${i + 1} | ${nm} | ${gz} | ${l.deps ?? "?"} | ${perf} | ${l.type} |`;
});
console.log(`| ${header.join(" | ")} |`);
console.log(`|${header.map(() => "---").join("|")}|`);
console.log(rows.join("\n"));
console.log("\n(perf columns are per-query time relative to krino=100% at that size; lower = faster)");
