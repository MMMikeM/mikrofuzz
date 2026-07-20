/**
 * Public search entry points: `fuzzyMatch` for a single string, and
 * `createFuzzySearch` for a preprocessed collection. Both delegate ranking to
 * `matchField`; this file owns query/field preprocessing and result sorting.
 */

import { matchField } from "./match";
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
	const normalizedField = normalizeText(text);
	const fieldWords = new Set(normalizedField.split(" "));

	const result = matchField(
		text,
		normalizedField,
		fieldWords,
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

	const preprocessed = collection.map((item) => {
		const texts = getText
			? getText(item)
			: key
				? [(item as Record<string, string>)[key]]
				: [item as unknown as string];

		const fields = texts.map((text) => {
			const field = text || "";
			const normalizedField = normalizeText(field);
			return [field, normalizedField, new Set(normalizedField.split(" "))] as const;
		});

		return [item, fields] as const;
	});

	return (query: string) => {
		const results: Array<FuzzyResult<T>> = [];
		const normalizedQuery = normalizeText(query);
		const queryWords = normalizedQuery.split(" ");

		if (!normalizedQuery.length) return [];

		for (const [item, fields] of preprocessed) {
			let bestScore = MAX_SAFE_INTEGER;
			const matches: FuzzyMatches = [];

			for (const [field, normalizedField, fieldWords] of fields) {
				const result = matchField(
					field,
					normalizedField,
					fieldWords,
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
				results.push({ item, score: bestScore, matches });
			}
		}

		return results.sort(sortByScore);
	};
};
