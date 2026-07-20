/**
 * The tier ladder as named constants. Lower = better. Any score greater than
 * CONTAINS is a fuzzy-fallback match (see fuzzy.ts). Exported so callers can
 * filter or re-rank by tier without hardcoding magic numbers.
 */
export const SCORES = {
	EXACT: 0,
	NORMALIZED_EXACT: 0.1,
	PREFIX: 0.5,
	BOUNDARY_EXACT: 0.9,
	BOUNDARY: 1,
	MULTI_WORD: 1.5,
	ACRONYM: 1.8,
	CONTAINS: 2,
} as const;
