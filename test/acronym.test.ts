/**
 * Acronym tier ranking/precedence. (Basic match is in primitive.test.ts; the
 * per-field toggle is in fields.test.ts.)
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch, fuzzyMatch, SCORES } from "../src/index";

describe("acronym tier", () => {
	it("does not fire when an earlier tier matches", () => {
		// "us army" starts with "us" → prefix wins
		expect(fuzzyMatch("us army", "us", { acronym: true })?.tier).toBe("prefix");
	});

	it("ranks an acronym match above an incidental contains", () => {
		const results = createFuzzySearch(["United States", "campus tour"], [
			{ text: (s) => s, acronym: true },
		])("us");
		expect(results.map((r) => r.item)).toEqual(["United States", "campus tour"]);
		expect(results[0]!.score).toBe(SCORES.ACRONYM); // 1.8
		expect(results[1]!.score).toBe(SCORES.CONTAINS); // 2 ("us" inside "campus")
	});
});
