/**
 * The tier ladder: rank one field string against a query, trying each tier in
 * order (exact → normalized-exact → prefix → boundary-contains → multi-word →
 * contains-anywhere → fuzzy fallback) and returning the first that matches.
 * Lower score = better. The `strategy` argument only selects the fuzzy fallback.
 */

import { aggressiveFuzzyMatch, smartFuzzyMatch } from "./fuzzy";
import { isValidWordBoundary } from "./shared";
import type { FuzzySearchStrategy, HighlightRanges, Range } from "./types";

const SCORES = {
	EXACT: 0,
	NORMALIZED_EXACT: 0.1,
	PREFIX: 0.5,
	BOUNDARY_EXACT: 0.9,
	BOUNDARY: 1,
	MULTI_WORD_BASE: 1.5,
	MULTI_WORD_PER_WORD: 0.2,
	CONTAINS: 2,
} as const;

const sortByRangeStart = (a: Range, b: Range): number => a[0] - b[0];

export const matchField = (
	field: string,
	normalizedField: string,
	fieldWords: Set<string>,
	query: string,
	normalizedQuery: string,
	queryWords: string[],
	strategy: FuzzySearchStrategy,
): [number, HighlightRanges] | null => {
	if (field === query) return [SCORES.EXACT, [[0, field.length - 1]]];

	const queryLen = query.length;
	const normalizedFieldLen = normalizedField.length;
	const normalizedQueryLen = normalizedQuery.length;

	if (normalizedField === normalizedQuery) return [SCORES.NORMALIZED_EXACT, [[0, normalizedFieldLen - 1]]];
	if (normalizedField.startsWith(normalizedQuery)) return [SCORES.PREFIX, [[0, normalizedQueryLen - 1]]];

	const exactContainsIdx = field.indexOf(query);
	if (exactContainsIdx > -1 && isValidWordBoundary(field[exactContainsIdx - 1])) {
		return [SCORES.BOUNDARY_EXACT, [[exactContainsIdx, exactContainsIdx + queryLen - 1]]];
	}

	const containsIdx = normalizedField.indexOf(normalizedQuery);
	if (containsIdx > -1 && isValidWordBoundary(normalizedField[containsIdx - 1])) {
		return [SCORES.BOUNDARY, [[containsIdx, containsIdx + queryLen - 1]]];
	}

	if (queryWords.length > 1 && queryWords.every((w) => fieldWords.has(w))) {
		return [
			SCORES.MULTI_WORD_BASE + queryWords.length * SCORES.MULTI_WORD_PER_WORD,
			queryWords
				.map((w) => {
					const i = normalizedField.indexOf(w);
					return [i, i + w.length - 1] as Range;
				})
				.sort(sortByRangeStart),
		];
	}

	if (containsIdx > -1) return [SCORES.CONTAINS, [[containsIdx, containsIdx + queryLen - 1]]];

	if (strategy === "aggressive") return aggressiveFuzzyMatch(normalizedField, normalizedQuery);
	if (strategy === "smart") return smartFuzzyMatch(normalizedField, normalizedQuery);
	return null;
};
