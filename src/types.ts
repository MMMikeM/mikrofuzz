/**
 * Range of indices in a string: [start, end] (inclusive)
 */
export type Range = [number, number];

/**
 * List of character ranges that should be highlighted
 */
export type HighlightRanges = Range[];

/**
 * Match results for each text field. Null if that field didn't match.
 */
export type FuzzyMatches = Array<HighlightRanges | null>;

/**
 * Result of fuzzy matching against an item.
 * Lower score = better match (think "error level")
 */
export type FuzzyResult<T> = {
	item: T;
	score: number;
	matches: FuzzyMatches;
};

/**
 * Fuzzy search strategy:
 * - 'off': No fuzzy matching, only exact/prefix/contains
 * - 'smart': Matches at word boundaries or 3+ char chunks (default)
 * - 'aggressive': Classic fuzzy - matches any letters in order
 */
export type FuzzySearchStrategy = "off" | "smart" | "aggressive";

/**
 * Options for createFuzzySearch
 */
export type FuzzySearchOptions = {
	/** Property key to search (for object arrays) */
	key?: string;
	/** Custom function to extract searchable strings from items */
	getText?: (item: unknown) => Array<string | null>;
	/** Search strategy (default: 'smart') */
	strategy?: FuzzySearchStrategy;
};

/**
 * A prepared fuzzy search function
 */
export type FuzzySearcher<T> = (query: string) => Array<FuzzyResult<T>>;
