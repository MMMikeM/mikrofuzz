/**
 * fuzzyMatch tier ladder, range semantics, and edge cases.
 *
 * Inputs are chosen to stay correct after the KNOWN-ISSUES bugs are fixed:
 * no punctuation adjacent to matched words (bug 1), the first occurrence of
 * a query is always the deciding one and contains-anywhere inputs have no
 * boundary occurrence at all (bugs 2-3), and multi-word scores are asserted
 * as a tier band with two-word queries only (bug 4).
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch, fuzzyMatch } from "../src/index";

describe("result shape", () => {
	it("returns the original text as item, with score and highlight ranges", () => {
		expect(fuzzyMatch("banana", "ban")).toEqual({
			item: "banana",
			score: 0.5,
			matches: [[[0, 2]]],
		});
	});

	it("returns null when nothing matches", () => {
		expect(fuzzyMatch("cherry", "xyz")).toBeNull();
	});
});

describe("tier 0 / 0.1 — exact match and case sensitivity", () => {
	it("raw exact match scores 0 with a full-span range", () => {
		const result = fuzzyMatch("Apple", "Apple");
		expect(result?.score).toBe(0);
		expect(result?.matches).toEqual([[[0, 4]]]);
	});

	it("case-different exact match scores 0.1", () => {
		expect(fuzzyMatch("Apple", "apple")?.score).toBe(0.1);
		expect(fuzzyMatch("apple", "APPLE")?.score).toBe(0.1);
	});

	it("diacritic-different exact match scores 0.1", () => {
		expect(fuzzyMatch("Café", "cafe")?.score).toBe(0.1);
		expect(fuzzyMatch("Łódź", "lodz")?.score).toBe(0.1);
	});
});

describe("tier 0.5 — prefix", () => {
	it("prefix scores 0.5 with a range covering the query", () => {
		const result = fuzzyMatch("banana", "ban");
		expect(result?.score).toBe(0.5);
		expect(result?.matches).toEqual([[[0, 2]]]);
	});

	it("prefix is case- and diacritic-insensitive", () => {
		expect(fuzzyMatch("Banana", "bAN")?.score).toBe(0.5);
	});
});

describe("tier 0.9 / 1 — contains at a word boundary", () => {
	it("exact-case boundary contains scores 0.9", () => {
		const result = fuzzyMatch("Hello World", "World");
		expect(result?.score).toBe(0.9);
		expect(result?.matches).toEqual([[[6, 10]]]);
	});

	it("case-insensitive boundary contains scores 1", () => {
		const result = fuzzyMatch("Hello World", "world");
		expect(result?.score).toBe(1);
		expect(result?.matches).toEqual([[[6, 10]]]);
	});

	it("partial word at a boundary scores 1 (README example)", () => {
		const result = fuzzyMatch("Hello World", "wor");
		expect(result?.score).toBe(1);
		expect(result?.matches).toEqual([[[6, 8]]]);
	});

	it.each([
		["well-known", "known", [5, 9]],
		["foo (bar)", "bar", [5, 7]],
		["2019–2024", "2024", [5, 8]],
	] as Array<[string, string, [number, number]]>)(
		"%j contains %j after a boundary character",
		(text, query, range) => {
			const result = fuzzyMatch(text, query);
			expect(result?.score).toBe(0.9);
			expect(result?.matches).toEqual([[range]]);
		},
	);
});

describe("tier 1.5+ — all query words present, any order", () => {
	// Exact multi-word scores are bug 4 territory (the formula will change);
	// only the tier band is asserted here, and only with two-word queries.
	it("scattered whole-word matches land between the boundary and contains tiers", () => {
		const result = fuzzyMatch("the quick brown fox", "fox quick");
		expect(result!.score).toBeGreaterThan(1);
		expect(result!.score).toBeLessThan(2);
	});

	it("ranges cover each word, sorted ascending", () => {
		const result = fuzzyMatch("the quick brown fox", "fox quick");
		expect(result?.matches).toEqual([
			[
				[4, 8],
				[16, 18],
			],
		]);
	});

	it("does not fire when query words are only substrings of item words", () => {
		// itemWords is {foxglove, quickly} — falls through to smart fuzzy
		const result = fuzzyMatch("foxglove quickly", "fox quick");
		expect(result!.score).toBeGreaterThan(2);
	});
});

describe("tier 2 — contains anywhere", () => {
	it.each([
		["concatenate", "cat", [3, 5]],
		["tsunami", "sun", [1, 3]],
		["banana", "nan", [2, 4]],
	] as Array<[string, string, [number, number]]>)(
		"%j contains %j mid-word only",
		(text, query, range) => {
			const result = fuzzyMatch(text, query);
			expect(result?.score).toBe(2);
			expect(result?.matches).toEqual([[range]]);
		},
	);
});

describe("edge cases", () => {
	it("empty text matches nothing", () => {
		expect(fuzzyMatch("", "a")).toBeNull();
	});

	it("query longer than text matches nothing", () => {
		expect(fuzzyMatch("cat", "catalog")).toBeNull();
	});
});

describe("range semantics", () => {
	it("ranges are [start, end] inclusive", () => {
		const result = fuzzyMatch("Hello World", "wor");
		const [start, end] = result!.matches[0]![0]!;
		expect("Hello World".slice(start, end + 1)).toBe("Wor");
	});

	it("fuzzy-tier ranges are ascending and non-overlapping", () => {
		const ranges = fuzzyMatch("big cat", "bigcat")!.matches[0]!;
		expect(ranges).toEqual([
			[0, 2],
			[4, 6],
		]);
		for (let i = 1; i < ranges.length; i++) {
			expect(ranges[i]![0]).toBeGreaterThan(ranges[i - 1]![1]);
		}
	});
});

describe("cross-API consistency", () => {
	it("createFuzzySearch on a one-item collection agrees with fuzzyMatch", () => {
		const corpus: Array<[string, string]> = [
			["banana", "ban"],
			["Hello World", "wor"],
			["concatenate", "cat"],
			["big cat", "bigcat"],
			["cherry", "xyz"],
		];
		for (const [text, query] of corpus) {
			const search = createFuzzySearch([text]);
			expect(search(query)[0]?.score).toBe(fuzzyMatch(text, query)?.score);
		}
	});
});

describe("tier monotonicity", () => {
	it("better tiers always score strictly lower on the same text", () => {
		const ladders: Array<[string, string[], number[]]> = [
			["banana", ["banana", "BANANA", "ban", "nan"], [0, 0.1, 0.5, 2]],
			["Hello World", ["Hello World", "hello world", "World", "world"], [0, 0.1, 0.9, 1]],
		];
		for (const [text, queries, expected] of ladders) {
			const scores = queries.map((query) => fuzzyMatch(text, query)!.score);
			expect(scores).toEqual(expected);
			for (let i = 1; i < scores.length; i++) {
				expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
			}
		}
	});
});
