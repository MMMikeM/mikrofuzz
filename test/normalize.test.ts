import { describe, expect, it } from "vitest";
import { normalizeText } from "../src/index";

const cases: Array<[string, string]> = [
	["HELLO", "hello"],
	["Café", "cafe"],
	["Über", "uber"],
	["jalapeño", "jalapeno"],
	// ł has no NFD decomposition — exercises the dedicated replace
	["Łódź", "lodz"],
	["Zażółć gęślą jaźń", "zazolc gesla jazn"],
	["  padded  ", "padded"],
	["MiXeD CaSe", "mixed case"],
	["", ""],
];

describe("normalizeText", () => {
	it.each(cases)("normalizes %j to %j", (input, expected) => {
		expect(normalizeText(input)).toBe(expected);
	});

	it("does not touch punctuation", () => {
		// If bug 1 (KNOWN-ISSUES) is fixed by normalizing punctuation to
		// spaces rather than by widening validWordBoundaries, update this pin.
		expect(normalizeText("a.b,c:d;e/f")).toBe("a.b,c:d;e/f");
	});

	it("preserves internal whitespace", () => {
		expect(normalizeText("a  b")).toBe("a  b");
	});

	it("is idempotent", () => {
		for (const [input] of cases) {
			const once = normalizeText(input);
			expect(normalizeText(once)).toBe(once);
		}
	});
});
