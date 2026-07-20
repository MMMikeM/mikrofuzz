/**
 * createFuzzySearch collection API: key/getText field extraction, empty
 * queries, sort order and stability, and the matches-per-field shape.
 * Inputs follow the same fix-resilience rules as fuzzy-match.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch } from "../src/index";

describe("string collections", () => {
	const search = createFuzzySearch(["apple", "banana", "cherry", "grape"]);

	it("returns matching items with score and ranges (README example)", () => {
		expect(search("ban")).toEqual([{ item: "banana", score: 0.5, matches: [[[0, 2]]] }]);
	});

	it("excludes non-matching items entirely", () => {
		expect(search("xyz")).toEqual([]);
	});

	it("empty collection returns no results", () => {
		expect(createFuzzySearch([])("anything")).toEqual([]);
	});
});

describe("empty and whitespace queries", () => {
	const search = createFuzzySearch(["apple"]);

	it.each([[""], ["   "], ["\t"]])("query %j returns no results", (query) => {
		expect(search(query)).toEqual([]);
	});
});

describe("key option", () => {
	const users = [
		{ id: 1, name: "John Doe" },
		{ id: 2, name: "Jane Smith" },
	];

	it("searches the named property and returns the original object reference", () => {
		const results = createFuzzySearch(users, { key: "name" })("john");
		expect(results).toHaveLength(1);
		expect(results[0]!.item).toBe(users[0]);
		expect(results[0]!.score).toBe(0.5);
		expect(results[0]!.matches).toEqual([[[0, 3]]]);
	});

	it("skips elements missing the key without crashing", () => {
		const collection = [{ name: "apple" }, { other: "x" }];
		const results = createFuzzySearch(collection, { key: "name" })("app");
		expect(results).toHaveLength(1);
		expect(results[0]!.item).toBe(collection[0]);
	});
});

describe("getText option (multi-field)", () => {
	type User = { name: string; email: string | null };
	// getText is typed (item: unknown) => ... (KNOWN-ISSUES feature request 3),
	// so the cast is required.
	const getText = (item: unknown) => {
		const user = item as User;
		return [user.name, user.email];
	};

	it("matches has one entry per field, null for non-matching fields", () => {
		const users: User[] = [{ name: "John Doe", email: "john@example.com" }];
		const results = createFuzzySearch(users, { getText })("doe");
		expect(results[0]!.score).toBe(1);
		expect(results[0]!.matches).toEqual([[[5, 7]], null]);
	});

	it("score is the minimum across fields", () => {
		const users: User[] = [{ name: "pineapple", email: "app@x.com" }];
		const results = createFuzzySearch(users, { getText })("app");
		expect(results[0]!.score).toBe(0.5); // email prefix (0.5) beats name mid-word contains (2)
		expect(results[0]!.matches).toEqual([[[4, 6]], [[0, 2]]]);
	});

	it("tolerates null entries from getText", () => {
		const users: User[] = [{ name: "John Doe", email: null }];
		const results = createFuzzySearch(users, { getText })("john");
		expect(results[0]!.score).toBe(0.5);
		expect(results[0]!.matches).toEqual([[[0, 3]], null]);
	});
});

describe("sort order", () => {
	// One item per tier; collection is shuffled so the sort does the work.
	// No punctuation anywhere (bug 1), no query occurrence whose first hit
	// is not the deciding one (bugs 2-3), multi-word asserted as a band with
	// a two-word query (bug 4).
	const ladder = [
		"green tea", // 0    exact
		"Green Tea", // 0.1  normalized exact
		"green tea ice cream", // 0.5  prefix
		"matcha green tea", // 0.9  boundary contains, exact case
		"iced Green Tea", // 1    boundary contains, normalized
		"tea garden green", // (1, 2)  multi-word
		"evergreen teapot", // 2    contains anywhere
		"greedy nectar team", // > 2  smart fuzzy
	];
	const collection = [
		"evergreen teapot",
		"tea garden green",
		"green tea",
		"greedy nectar team",
		"iced Green Tea",
		"green tea ice cream",
		"Green Tea",
		"matcha green tea",
	];
	const results = createFuzzySearch(collection)("green tea");

	it("walks the full tier ladder in order", () => {
		expect(results.map((r) => r.item)).toEqual(ladder);
	});

	it("assigns the documented tier scores", () => {
		const byItem = new Map(results.map((r) => [r.item, r.score]));
		expect(byItem.get("green tea")).toBe(0);
		expect(byItem.get("Green Tea")).toBe(0.1);
		expect(byItem.get("green tea ice cream")).toBe(0.5);
		expect(byItem.get("matcha green tea")).toBe(0.9);
		expect(byItem.get("iced Green Tea")).toBe(1);
		const multiWord = byItem.get("tea garden green")!;
		expect(multiWord).toBeGreaterThan(1);
		expect(multiWord).toBeLessThan(2);
		expect(byItem.get("evergreen teapot")).toBe(2);
		expect(byItem.get("greedy nectar team")!).toBeGreaterThan(2);
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
	it("diacritic-insensitive match through the collection API", () => {
		const results = createFuzzySearch(["Señor García"])("garcia");
		expect(results[0]!.score).toBe(1);
		expect(results[0]!.matches).toEqual([[[6, 11]]]);
	});

	it("normalized-exact match for special characters", () => {
		expect(createFuzzySearch(["Łódź"])("lodz")[0]!.score).toBe(0.1);
	});
});
