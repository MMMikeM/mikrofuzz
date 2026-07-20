/**
 * createFuzzySearch: string arrays, the getText overload, sort order, stability.
 * (Per-field specs + penalty live in fields.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch } from "../src/index";

describe("string collections", () => {
	const search = createFuzzySearch(["apple", "banana", "cherry", "grape"]);

	it("returns matching items with score and per-field result", () => {
		expect(search("ban")).toEqual([
			{ item: "banana", score: 0.5, fields: [{ score: 0.5, tier: "prefix", ranges: [[0, 2]] }] },
		]);
	});

	it("excludes non-matching items", () => {
		expect(search("xyz")).toEqual([]);
	});

	it("empty collection → []", () => {
		expect(createFuzzySearch([])("anything")).toEqual([]);
	});
});

describe("empty and whitespace queries", () => {
	const search = createFuzzySearch(["apple"]);
	it.each([[""], ["   "], ["\t"]])("query %j → []", (query) => {
		expect(search(query)).toEqual([]);
	});
});

describe("getText overload", () => {
	const users = [
		{ id: 1, name: "John Doe" },
		{ id: 2, name: "Jane Smith" },
	];

	it("searches the extracted text; item is the original reference", () => {
		const results = createFuzzySearch(users, (u) => u.name)("john");
		expect(results).toHaveLength(1);
		expect(results[0]!.item).toBe(users[0]);
		expect(results[0]!.score).toBe(0.5);
		expect(results[0]!.fields[0]).toEqual({ score: 0.5, tier: "prefix", ranges: [[0, 3]] });
	});

	it("skips items whose text is null", () => {
		const collection: Array<{ name?: string }> = [{ name: "apple" }, { name: undefined }];
		const results = createFuzzySearch(collection, (i) => i.name ?? null)("app");
		expect(results).toHaveLength(1);
		expect(results[0]!.item).toBe(collection[0]);
	});
});

describe("sort order — full tier ladder in one search", () => {
	const collection = [
		"evergreen teapot", // contains (2)
		"tea garden green", // multi-word (1.5)
		"green tea", // exact (0)
		"greedy nectar team", // fuzzy (>2)
		"iced Green Tea", // boundary (1)
		"green tea ice cream", // prefix (0.5)
		"Green Tea", // normalized-exact (0.1)
		"matcha green tea", // boundary-exact (0.9)
	];
	const results = createFuzzySearch(collection)("green tea");

	it("walks the ladder in order", () => {
		expect(results.map((r) => r.item)).toEqual([
			"green tea",
			"Green Tea",
			"green tea ice cream",
			"matcha green tea",
			"iced Green Tea",
			"tea garden green",
			"evergreen teapot",
			"greedy nectar team",
		]);
	});

	it("scores are non-decreasing", () => {
		for (let i = 1; i < results.length; i++) {
			expect(results[i]!.score).toBeGreaterThanOrEqual(results[i - 1]!.score);
		}
	});
});

describe("sort stability", () => {
	it("equal scores preserve collection order", () => {
		expect(createFuzzySearch(["banana", "bandana"])("ban").map((r) => r.item)).toEqual([
			"banana",
			"bandana",
		]);
		expect(createFuzzySearch(["bandana", "banana"])("ban").map((r) => r.item)).toEqual([
			"bandana",
			"banana",
		]);
	});
});

describe("unicode", () => {
	it("diacritic-insensitive match", () => {
		const r = createFuzzySearch(["Señor García"], (s) => s)("garcia")[0]!;
		expect(r.score).toBe(1);
		expect(r.fields[0]?.ranges).toEqual([[6, 11]]);
	});

	it("normalized-exact for special characters", () => {
		expect(createFuzzySearch(["Łódź"])("lodz")[0]!.score).toBe(0.1);
	});
});
