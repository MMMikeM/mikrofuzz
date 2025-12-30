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

import { normalizeText } from "./normalize";
import type {
	FuzzyMatches,
	FuzzyResult,
	FuzzySearcher,
	FuzzySearchOptions,
	FuzzySearchStrategy,
	HighlightRanges,
	Range,
} from "./types";

export { normalizeText } from "./normalize";
export type * from "./types";

const { MAX_SAFE_INTEGER } = Number;

const sortByScore = <T>(a: FuzzyResult<T>, b: FuzzyResult<T>): number => a.score - b.score;
const sortRangeTuple = (a: Range, b: Range): number => a[0] - b[0];

const validWordBoundaries = new Set('  []()-–—\'"""'.split(""));
const isValidWordBoundary = (char: string): boolean => validWordBoundaries.has(char);

const scoreConsecutiveLetters = (
	indices: HighlightRanges,
	normalizedItem: string,
): [number, HighlightRanges] => {
	let score = 2;
	for (const [firstIdx, lastIdx] of indices) {
		const chunkLength = lastIdx - firstIdx + 1;
		const isStartOfWord = firstIdx === 0 || normalizedItem[firstIdx - 1] === " ";
		const isEndOfWord =
			lastIdx === normalizedItem.length - 1 || normalizedItem[lastIdx + 1] === " ";
		if (isStartOfWord && isEndOfWord) score += 0.2;
		else if (isStartOfWord) score += 0.4;
		else if (chunkLength >= 3) score += 0.8;
		else score += 1.6;
	}
	return [score, indices];
};

const aggressiveFuzzyMatch = (
	normalizedItem: string,
	normalizedQuery: string,
): [number, HighlightRanges] | null => {
	const normalizedItemLen = normalizedItem.length;
	const normalizedQueryLen = normalizedQuery.length;
	let queryIdx = 0;
	let queryChar = normalizedQuery[queryIdx];
	const indices: HighlightRanges = [];
	let chunkFirstIdx = -1;
	let chunkLastIdx = -2;

	for (let itemIdx = 0; itemIdx < normalizedItemLen; itemIdx++) {
		if (normalizedItem[itemIdx] === queryChar) {
			if (itemIdx !== chunkLastIdx + 1) {
				if (chunkFirstIdx >= 0) indices.push([chunkFirstIdx, chunkLastIdx]);
				chunkFirstIdx = itemIdx;
			}
			chunkLastIdx = itemIdx;
			queryIdx++;
			if (queryIdx === normalizedQueryLen) {
				indices.push([chunkFirstIdx, chunkLastIdx]);
				return scoreConsecutiveLetters(indices, normalizedItem);
			}
			queryChar = normalizedQuery[queryIdx];
		}
	}
	return null;
};

const smartFuzzyMatch = (
	normalizedItem: string,
	normalizedQuery: string,
): [number, HighlightRanges] | null => {
	const normalizedItemLen = normalizedItem.length;
	const indices: HighlightRanges = [];
	let queryIdx = 0;
	let queryChar = normalizedQuery[queryIdx];
	let chunkFirstIdx = -1;
	let chunkLastIdx = -2;

	while (true) {
		const idx = normalizedItem.indexOf(queryChar, chunkLastIdx + 1);
		if (idx === -1) break;

		if (idx === 0 || isValidWordBoundary(normalizedItem[idx - 1])) {
			chunkFirstIdx = idx;
		} else {
			const queryCharsLeft = normalizedQuery.length - queryIdx;
			const itemCharsLeft = normalizedItem.length - idx;
			const minChunkLen = Math.min(3, queryCharsLeft, itemCharsLeft);
			const minQueryChunk = normalizedQuery.slice(queryIdx, queryIdx + minChunkLen);
			if (normalizedItem.slice(idx, idx + minChunkLen) === minQueryChunk) {
				chunkFirstIdx = idx;
			} else {
				chunkLastIdx++;
				continue;
			}
		}

		for (chunkLastIdx = chunkFirstIdx; chunkLastIdx < normalizedItemLen; chunkLastIdx++) {
			if (normalizedItem[chunkLastIdx] !== queryChar) break;
			queryIdx++;
			queryChar = normalizedQuery[queryIdx];
		}

		chunkLastIdx--;
		indices.push([chunkFirstIdx, chunkLastIdx]);

		if (queryIdx === normalizedQuery.length) {
			return scoreConsecutiveLetters(indices, normalizedItem);
		}
	}
	return null;
};

const matchesFuzzily = (
	item: string,
	normalizedItem: string,
	itemWords: Set<string>,
	query: string,
	normalizedQuery: string,
	queryWords: string[],
	strategy: FuzzySearchStrategy,
): [number, HighlightRanges] | null => {
	if (item === query) return [0, [[0, item.length - 1]]];

	const queryLen = query.length;
	const normalizedItemLen = normalizedItem.length;
	const normalizedQueryLen = normalizedQuery.length;

	if (normalizedItem === normalizedQuery) return [0.1, [[0, normalizedItemLen - 1]]];
	if (normalizedItem.startsWith(normalizedQuery)) return [0.5, [[0, normalizedQueryLen - 1]]];

	const exactContainsIdx = item.indexOf(query);
	if (exactContainsIdx > -1 && isValidWordBoundary(item[exactContainsIdx - 1])) {
		return [0.9, [[exactContainsIdx, exactContainsIdx + queryLen - 1]]];
	}

	const containsIdx = normalizedItem.indexOf(normalizedQuery);
	if (containsIdx > -1 && isValidWordBoundary(normalizedItem[containsIdx - 1])) {
		return [1, [[containsIdx, containsIdx + queryLen - 1]]];
	}

	if (queryWords.length > 1 && queryWords.every((w) => itemWords.has(w))) {
		return [
			1.5 + queryWords.length * 0.2,
			queryWords
				.map((w) => {
					const i = normalizedItem.indexOf(w);
					return [i, i + w.length - 1] as Range;
				})
				.sort(sortRangeTuple),
		];
	}

	if (containsIdx > -1) return [2, [[containsIdx, containsIdx + queryLen - 1]]];

	if (strategy === "aggressive") return aggressiveFuzzyMatch(normalizedItem, normalizedQuery);
	if (strategy === "smart") return smartFuzzyMatch(normalizedItem, normalizedQuery);
	return null;
};

/**
 * One-off fuzzy match of a single string against a query.
 * Use createFuzzySearch for searching collections.
 */
export const fuzzyMatch = (text: string, query: string): FuzzyResult<string> | null => {
	const normalizedQuery = normalizeText(query);
	const queryWords = normalizedQuery.split(" ");
	const normalizedText = normalizeText(text);
	const itemWords = new Set(normalizedText.split(" "));

	const result = matchesFuzzily(
		text,
		normalizedText,
		itemWords,
		query,
		normalizedQuery,
		queryWords,
		"smart",
	);

	if (result) {
		return { item: text, score: result[0], matches: [result[1]] };
	}
	return null;
};

/**
 * Creates a fuzzy search function for a collection.
 *
 * @example
 * // Search array of strings
 * const search = createFuzzySearch(['apple', 'banana', 'cherry']);
 * search('ban'); // [{ item: 'banana', score: 0.5, matches: [...] }]
 *
 * @example
 * // Search array of objects by key
 * const search = createFuzzySearch(users, { key: 'name' });
 * search('john');
 *
 * @example
 * // Search multiple fields
 * const search = createFuzzySearch(users, {
 *   getText: (user) => [user.name, user.email]
 * });
 */
export const createFuzzySearch = <T>(
	collection: T[],
	options: FuzzySearchOptions = {},
): FuzzySearcher<T> => {
	const { strategy = "smart", getText, key } = options;

	const preprocessed = collection.map((element) => {
		const texts = getText
			? getText(element)
			: key
				? [(element as Record<string, string>)[key]]
				: [element as unknown as string];

		const processed = texts.map((text) => {
			const item = text || "";
			const normalized = normalizeText(item);
			return [item, normalized, new Set(normalized.split(" "))] as const;
		});

		return [element, processed] as const;
	});

	return (query: string) => {
		const results: Array<FuzzyResult<T>> = [];
		const normalizedQuery = normalizeText(query);
		const queryWords = normalizedQuery.split(" ");

		if (!normalizedQuery.length) return [];

		for (const [element, texts] of preprocessed) {
			let bestScore = MAX_SAFE_INTEGER;
			const matches: FuzzyMatches = [];

			for (const [item, normalizedItem, itemWords] of texts) {
				const result = matchesFuzzily(
					item,
					normalizedItem,
					itemWords,
					query,
					normalizedQuery,
					queryWords,
					strategy,
				);
				if (result) {
					bestScore = Math.min(bestScore, result[0]);
					matches.push(result[1]);
				} else {
					matches.push(null);
				}
			}

			if (bestScore < MAX_SAFE_INTEGER) {
				results.push({ item: element, score: bestScore, matches });
			}
		}

		return results.sort(sortByScore);
	};
};
