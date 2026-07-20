/**
 * Strategy behaviour and fuzzy chunk scoring. Everything goes through
 * createFuzzySearch because fuzzyMatch hardcodes the smart strategy.
 * Fuzzy-tier scores are runtime sums (2 + per-chunk bonuses), so they use
 * toBeCloseTo.
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch } from "../src/index";

describe("smart strategy (default)", () => {
	it("matches chunks starting at word boundaries", () => {
		const results = createFuzzySearch(["hello world"])("hewo");
		expect(results).toHaveLength(1);
		expect(results[0]!.score).toBeCloseTo(2.8); // 2 + 0.4 + 0.4: two word-start chunks
		expect(results[0]!.matches).toEqual([
			[
				[0, 1],
				[6, 7],
			],
		]);
	});

	it("accepts mid-word chunks of 3+ characters", () => {
		const results = createFuzzySearch(["xylophone tuner"])("phonetun");
		expect(results[0]!.score).toBeCloseTo(3.2); // 2 + 0.8 (len-5 mid-word) + 0.4 (word start)
		expect(results[0]!.matches).toEqual([
			[
				[4, 8],
				[10, 12],
			],
		]);
	});

	it("rejects short mid-word chunks", () => {
		expect(createFuzzySearch(["abcdef"])("adf")).toEqual([]);
	});
});

describe("aggressive strategy", () => {
	it("matches any in-order subsequence", () => {
		const results = createFuzzySearch(["abcdef"], { strategy: "aggressive" })("adf");
		expect(results[0]!.score).toBeCloseTo(5.6); // 2 + 0.4 + 1.6 + 1.6
		expect(results[0]!.matches).toEqual([
			[
				[0, 0],
				[3, 3],
				[5, 5],
			],
		]);
	});

	it("agrees with smart when chunks are boundary-aligned", () => {
		const results = createFuzzySearch(["hello world"], { strategy: "aggressive" })("hewo");
		expect(results[0]!.score).toBeCloseTo(2.8);
	});
});

describe("strategy 'off'", () => {
	const search = createFuzzySearch(["big cat"], { strategy: "off" });

	it("disables the fuzzy tier", () => {
		expect(search("bigcat")).toEqual([]);
	});

	it("keeps the exact, prefix, and contains tiers", () => {
		expect(search("big")[0]?.score).toBe(0.5);
		expect(search("cat")[0]?.score).toBe(0.9);
	});
});

describe("chunk scoring", () => {
	it("full-word chunks are cheapest", () => {
		const results = createFuzzySearch(["big cat"])("bigcat");
		expect(results[0]!.score).toBeCloseTo(2.4); // 2 + 0.2 + 0.2: both chunks are whole words
		expect(results[0]!.matches).toEqual([
			[
				[0, 2],
				[4, 6],
			],
		]);
	});

	it("word-start chunks cost more than whole words", () => {
		const results = createFuzzySearch(["sad unknown night"])("sun");
		expect(results[0]!.score).toBeCloseTo(2.8); // 2 + 0.4 + 0.4
		expect(results[0]!.matches).toEqual([
			[
				[0, 0],
				[4, 5],
			],
		]);
	});

	it("fewer, cleaner chunks beat fragmented ones", () => {
		const clean = createFuzzySearch(["big cat"])("bigcat")[0]!.score;
		const fragmented = createFuzzySearch(["abcdef"], { strategy: "aggressive" })("adf")[0]!.score;
		expect(clean).toBeLessThan(fragmented);
	});
});
