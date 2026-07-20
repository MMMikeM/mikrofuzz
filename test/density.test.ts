/**
 * The matchDensity helper: matched characters ÷ inclusive span.
 */
import { describe, expect, it } from "vitest";
import { matchDensity } from "../src/index";

describe("matchDensity", () => {
	it("empty ranges → 0", () => {
		expect(matchDensity([])).toBe(0);
	});

	it("a single solid run → 1", () => {
		expect(matchDensity([[3, 7]])).toBe(1);
	});

	it("adjacent runs → 1", () => {
		expect(
			matchDensity([
				[0, 2],
				[3, 5],
			]),
		).toBe(1);
	});

	it("scattered single characters → matched ÷ span", () => {
		// two 1-char matches across span 0..7: 2 / 8
		expect(
			matchDensity([
				[0, 0],
				[7, 7],
			]),
		).toBeCloseTo(0.25);
	});
});
