/**
 * Executable companion to KNOWN-ISSUES.md.
 *
 * Each bug is a describe block: passing tests pin the current (wrong)
 * behaviour and its control case; `it.fails` tests assert the desired
 * behaviour. When a bug gets fixed, its `it.fails` test starts passing,
 * vitest reports it as an unexpected pass, and the fix must delete the
 * `.fails` marker (and the matching current-behaviour pin). The suite is
 * green while the bugs exist — it's a tracker, not a wishlist.
 *
 * All repros were found integrating the library into a blog search
 * (title/excerpt/topic fields fuzzy, body vocabulary contains-only).
 */
import { describe, expect, it } from "vitest";
import { createFuzzySearch, fuzzyMatch } from "../src/index";

describe("bug 1: punctuation is not a word boundary", () => {
	// validWordBoundaries has brackets/dashes/quotes but no . , : ; /
	// and itemWords splits on spaces only, so "build," never equals "build".

	it("control: without the comma, both query words are found (multi-word tier)", () => {
		const result = fuzzyMatch("Fail the build not the runtime", "build runtime");
		expect(result?.score).toBeCloseTo(1.9); // 1.5 + 2 words * 0.2
	});

	it("current: a comma glued to 'build' pushes the match into the fuzzy tier", () => {
		const result = fuzzyMatch("Fail the build, not the runtime", "build runtime");
		expect(result!.score).toBeGreaterThan(2); // 3.2 today
	});

	it.fails("desired: ',' after a word does not change the word's tier", () => {
		const result = fuzzyMatch("Fail the build, not the runtime", "build runtime");
		expect(result?.score).toBeCloseTo(1.9);
	});

	it("control: word after a space matches at the boundary tier", () => {
		expect(fuzzyMatch("foo bar", "bar")?.score).toBe(0.9);
	});

	it("current: word after a period only reaches the contains-anywhere tier", () => {
		expect(fuzzyMatch("foo.bar", "bar")?.score).toBe(2);
	});

	it.fails("desired: '.' is a word boundary like ' ' and '-'", () => {
		expect(fuzzyMatch("foo.bar", "bar")?.score).toBeLessThan(2);
	});
});

describe("bug 2: boundary-contains tier only checks the first occurrence", () => {
	// indexOf finds "actor" inside "factor", the boundary check fails, and
	// the standalone "actor" one word later is never examined.

	it("control: boundary occurrence first scores as a prefix match", () => {
		expect(fuzzyMatch("actor factor model", "actor")?.score).toBe(0.5);
	});

	it("current: mid-word occurrence first demotes to contains-anywhere", () => {
		expect(fuzzyMatch("factor actor model", "actor")?.score).toBe(2);
	});

	it.fails("desired: a later occurrence at a word boundary earns the boundary tier", () => {
		expect(fuzzyMatch("factor actor model", "actor")?.score).toBeLessThanOrEqual(1);
	});
});

describe("bug 3: highlight ranges land inside the wrong word", () => {
	// Same indexOf habit as bug 2, surfacing in the returned ranges:
	// "cat" highlights con[cat]enate instead of the standalone word.

	it("current: range points into 'concatenate'", () => {
		const result = fuzzyMatch("concatenate the cat", "cat");
		expect(result?.matches).toEqual([[[3, 5]]]);
	});

	it.fails("desired: range covers the standalone 'cat' at index 16", () => {
		const result = fuzzyMatch("concatenate the cat", "cat");
		expect(result?.matches).toEqual([[[16, 18]]]);
	});
});

describe("bug 4: multi-word tier penalises specificity", () => {
	// Score is 1.5 + queryWords.length * 0.2, so every extra word a user
	// types — narrowing the match — ranks the same item worse. Only visible
	// when the words are scattered; contiguous phrases hit the contains tier
	// first.

	it("current: three scattered words score worse than two", () => {
		const text = "lag story of the event and the loop";
		const two = fuzzyMatch(text, "event loop")!.score; // 1.9
		const three = fuzzyMatch(text, "event loop lag")!.score; // 2.1
		expect(three).toBeGreaterThan(two);
	});

	it.fails("desired: a more specific all-words match never ranks worse", () => {
		const text = "lag story of the event and the loop";
		const two = fuzzyMatch(text, "event loop")!.score;
		const three = fuzzyMatch(text, "event loop lag")!.score;
		expect(three).toBeLessThanOrEqual(two);
	});
});

describe("bug 5: fuzzyMatch accepts an empty query", () => {
	// The empty-query guard lives only in createFuzzySearch; in fuzzyMatch
	// the query survives to startsWith(""), which is always true.

	it("control: createFuzzySearch returns no results for an empty query", () => {
		expect(createFuzzySearch(["abc"])("")).toEqual([]);
	});

	it("current: empty query scores 0.5 with a degenerate range", () => {
		const result = fuzzyMatch("abc", "");
		expect(result?.score).toBe(0.5);
		expect(result?.matches).toEqual([[[0, -1]]]);
	});

	it.fails("desired: empty query matches nothing, like createFuzzySearch", () => {
		expect(fuzzyMatch("abc", "")).toBeNull();
	});
});

describe("bug 6: highlight width uses the raw query length", () => {
	// Tiers 0.9/1/2 build ranges as [idx, idx + query.length - 1] with the
	// raw (un-normalized) query length against normalized-text indices, so
	// whitespace padding in the query widens the highlight past the match.

	it("control: trimmed query highlights exactly the matched letters", () => {
		expect(fuzzyMatch("Hello World", "wor")?.matches).toEqual([[[6, 8]]]);
	});

	it("current: padded query widens the range past the match", () => {
		const result = fuzzyMatch("Hello World", " wor ");
		expect(result?.score).toBe(1); // still the boundary tier — only the range is wrong
		expect(result?.matches).toEqual([[[6, 10]]]);
	});

	it.fails("desired: padding in the query does not change the highlight", () => {
		expect(fuzzyMatch("Hello World", " wor ")?.matches).toEqual([[[6, 8]]]);
	});
});

describe("hazard (documentation, not a bug): smart fuzzy over long text", () => {
	// Chunks only need a word-boundary start or a 3-char run; across a few
	// thousand words of vocabulary, short queries assemble junk chains.
	// In an 8-post blog index, "banana" matched every post. Fuzzy strategies
	// suit short labels; document-length text wants strategy: 'off'.

	it("current: 'zebra' matches text containing only 'zero' and 'branch'", () => {
		const vocabulary = "zero cost branch prediction and other stories";
		const result = fuzzyMatch(vocabulary, "zebra");
		expect(result).not.toBeNull();
		expect(result!.score).toBeGreaterThan(2);
	});
});
