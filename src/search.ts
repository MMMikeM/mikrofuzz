/**
 * Public search entry points: `fuzzyMatch` for a single string, and
 * `createFuzzySearch` for a preprocessed collection. Both delegate ranking to
 * `matchesFuzzily`; this file owns query/field preprocessing and result sorting.
 */

import { matchesFuzzily } from "./match";
import { normalizeText } from "./normalize";
import type { FuzzyMatches, FuzzyResult, FuzzySearcher, FuzzySearchOptions } from "./types";

const { MAX_SAFE_INTEGER } = Number;

const sortByScore = <T>(a: FuzzyResult<T>, b: FuzzyResult<T>): number => a.score - b.score;

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
