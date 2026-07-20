/**
 * Public search entry points:
 * - `fuzzyMatch` — the primitive: score one string against a query.
 * - `createFuzzySearch` — a preprocessing-cached, sorted search over a collection,
 *   built on the primitive. Second arg is a `getText` fn or an array of field specs.
 */

import { buildFuzzyGate } from "./fuzzy";
import { matchField, type MatchQuery } from "./match";
import { normalizeText, splitWords } from "./normalize";
import type {
	FieldSpec,
	FuzzyResult,
	FuzzySearcher,
	MatchOptions,
	MatchResult,
	Strategy,
} from "./types";

const { MAX_SAFE_INTEGER } = Number;

const sortByScore = <T>(a: FuzzyResult<T>, b: FuzzyResult<T>): number => a.score - b.score;

// Build the query-derived state once, reused across every field.
const prepareQuery = (query: string, normalizedQuery: string): MatchQuery => ({
	query,
	normalizedQuery,
	queryWords: splitWords(normalizedQuery),
	fuzzyGate: buildFuzzyGate(normalizedQuery),
});

/**
 * Score one string against a query. Returns { score, tier, ranges } or null.
 */
export const fuzzyMatch = (
	text: string,
	query: string,
	options: MatchOptions = {},
): MatchResult | null => {
	const { strategy = "smart", acronym = false } = options;
	const normalizedQuery = normalizeText(query);
	if (!normalizedQuery.length) return null;

	const q = prepareQuery(query, normalizedQuery);
	const normalizedField = normalizeText(text);
	const fieldWords = new Set(splitWords(normalizedField));

	return matchField(text, normalizedField, fieldWords, q, strategy, acronym);
};

// A preprocessed field: its cached normalized form plus its matching config.
type PreparedField = {
	field: string;
	normalizedField: string;
	fieldWords: Set<string>;
	strategy: Strategy;
	acronym: boolean;
	penalty: number;
};

const prepareField = (
	text: string | null,
	strategy: Strategy,
	acronym: boolean,
	penalty: number,
): PreparedField => {
	const field = text || "";
	const normalizedField = normalizeText(field);
	return {
		field,
		normalizedField,
		fieldWords: new Set(splitWords(normalizedField)),
		strategy,
		acronym,
		penalty,
	};
};

/**
 * Creates a fuzzy search function for a collection.
 *
 * @example
 * // Array of strings
 * const search = createFuzzySearch(['apple', 'banana']);
 * search('ban'); // [{ item: 'banana', score: 0.5, fields: [{ score: 0.5, tier: 'prefix', ranges: [[0, 2]] }] }]
 *
 * @example
 * // Objects, one field
 * const search = createFuzzySearch(users, (u) => u.name);
 *
 * @example
 * // Multiple fields, per-field config (body never outranks title)
 * const search = createFuzzySearch(posts, [
 *   { text: (p) => p.title, strategy: 'smart' },
 *   { text: (p) => p.body, strategy: 'off', penalty: SCORES.CONTAINS },
 * ]);
 */
export function createFuzzySearch(list: string[]): FuzzySearcher<string>;
export function createFuzzySearch<T>(
	list: T[],
	getText: (item: T) => string | null,
): FuzzySearcher<T>;
export function createFuzzySearch<T>(list: T[], fields: FieldSpec<T>[]): FuzzySearcher<T>;
export function createFuzzySearch<T>(
	list: T[],
	extract?: ((item: T) => string | null) | FieldSpec<T>[],
): FuzzySearcher<T> {
	const specs: FieldSpec<T>[] = !extract
		? [{ text: (item) => item as unknown as string }]
		: typeof extract === "function"
			? [{ text: extract }]
			: extract;

	const preprocessed = list.map((item) => {
		const prepared = specs.map((s) =>
			prepareField(s.text(item), s.strategy ?? "smart", s.acronym ?? false, s.penalty ?? 0),
		);
		return [item, prepared] as const;
	});

	return (query: string) => {
		const normalizedQuery = normalizeText(query);
		if (!normalizedQuery.length) return [];

		const q = prepareQuery(query, normalizedQuery);
		const results: Array<FuzzyResult<T>> = [];

		for (const [item, prepared] of preprocessed) {
			let bestScore = MAX_SAFE_INTEGER;
			const fields: Array<MatchResult | null> = [];

			for (const p of prepared) {
				const result = matchField(p.field, p.normalizedField, p.fieldWords, q, p.strategy, p.acronym);
				if (result) {
					const effective = { ...result, score: result.score + p.penalty };
					bestScore = Math.min(bestScore, effective.score);
					fields.push(effective);
				} else {
					fields.push(null);
				}
			}

			if (bestScore < MAX_SAFE_INTEGER) {
				results.push({ item, score: bestScore, fields });
			}
		}

		return results.sort(sortByScore);
	};
}
