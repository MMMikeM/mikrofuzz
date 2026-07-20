/**
 * Fuzzy search library
 * Adapted from @nozbe/microfuzz with Vite SSR compatibility
 *
 * Scoring (lower = better):
 * - 0:    Exact match
 * - 0.1:  Case/diacritics-insensitive exact match
 * - 0.5:  Starts with query
 * - 0.9:  Contains query at word boundary (exact case)
 * - 1:    Contains query at word boundary
 * - 1.5+: Contains all query words (in any order)
 * - 2:    Contains query anywhere
 * - 2+:   Fuzzy match (fewer chunks = better)
 */

export { createFuzzySearch, fuzzyMatch } from "./search";
export { normalizeText } from "./normalize";
export type * from "./types";
