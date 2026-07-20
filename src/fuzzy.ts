/**
 * The fuzzy fallback tier: assemble a query out of consecutive-letter chunks
 * found in the field, and score the assembly (fewer, cleaner chunks = lower =
 * better). `smart` only accepts chunks that start at a word boundary or run
 * 3+ characters; `aggressive` accepts any in-order subsequence.
 */

import { isValidWordBoundary } from "./shared";
import type { HighlightRanges, Range } from "./types";

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A cheap native gate for the fuzzy tier: the query's characters, in order, with
 * anything between. Both fuzzy strategies require the query to be a subsequence
 * of the field, so a field that fails this test can never match — skip the
 * expensive hand-rolled matcher. Built once per query, tested per field.
 */
export const buildFuzzyGate = (normalizedQuery: string): RegExp =>
	new RegExp([...normalizedQuery].map(escapeRegex).join("[^]*"));

// A consecutive run of matched characters. Same shape as a highlight Range,
// named distinctly because it means "matched run", not "span to highlight".
type Chunk = Range;

// Chunk-scoring constants. BASE equals SCORES.CONTAINS (2) by design — a fuzzy
// match must never beat a true contains — but the two are intentionally NOT the
// same binding, since they mean different things and could diverge.
const CHUNK_SCORES = {
	BASE: 2,
	WHOLE_WORD: 0.2,
	WORD_START: 0.4,
	LONG: 0.8,
	SCATTERED: 1.6,
} as const;

const scoreConsecutiveLetters = (
	chunks: Chunk[],
	normalizedField: string,
): [number, HighlightRanges] => {
	let score = CHUNK_SCORES.BASE;
	for (const [start, end] of chunks) {
		const chunkLen = end - start + 1;
		const isStartOfWord = start === 0 || normalizedField[start - 1] === " ";
		const isEndOfWord =
			end === normalizedField.length - 1 || normalizedField[end + 1] === " ";
		if (isStartOfWord && isEndOfWord) score += CHUNK_SCORES.WHOLE_WORD;
		else if (isStartOfWord) score += CHUNK_SCORES.WORD_START;
		else if (chunkLen >= 3) score += CHUNK_SCORES.LONG;
		else score += CHUNK_SCORES.SCATTERED;
	}
	return [score, chunks];
};

export const aggressiveFuzzyMatch = (
	normalizedField: string,
	normalizedQuery: string,
): [number, HighlightRanges] | null => {
	const normalizedFieldLen = normalizedField.length;
	const normalizedQueryLen = normalizedQuery.length;
	let queryIdx = 0;
	let queryChar = normalizedQuery[queryIdx];
	const chunks: Chunk[] = [];
	let chunkStart = -1;
	let chunkEnd = -2;

	for (let fieldIdx = 0; fieldIdx < normalizedFieldLen; fieldIdx++) {
		if (normalizedField[fieldIdx] === queryChar) {
			if (fieldIdx !== chunkEnd + 1) {
				if (chunkStart >= 0) chunks.push([chunkStart, chunkEnd]);
				chunkStart = fieldIdx;
			}
			chunkEnd = fieldIdx;
			queryIdx++;
			if (queryIdx === normalizedQueryLen) {
				chunks.push([chunkStart, chunkEnd]);
				return scoreConsecutiveLetters(chunks, normalizedField);
			}
			queryChar = normalizedQuery[queryIdx];
		}
	}
	return null;
};

export const smartFuzzyMatch = (
	normalizedField: string,
	normalizedQuery: string,
): [number, HighlightRanges] | null => {
	const normalizedFieldLen = normalizedField.length;
	const chunks: Chunk[] = [];
	let queryIdx = 0;
	let queryChar = normalizedQuery[queryIdx];
	let chunkStart = -1;
	let chunkEnd = -2;

	while (true) {
		const idx = normalizedField.indexOf(queryChar, chunkEnd + 1);
		if (idx === -1) break;

		if (idx === 0 || isValidWordBoundary(normalizedField[idx - 1])) {
			chunkStart = idx;
		} else {
			const queryCharsLeft = normalizedQuery.length - queryIdx;
			const fieldCharsLeft = normalizedField.length - idx;
			const minChunkLen = Math.min(3, queryCharsLeft, fieldCharsLeft);
			const minQueryChunk = normalizedQuery.slice(queryIdx, queryIdx + minChunkLen);
			if (normalizedField.slice(idx, idx + minChunkLen) === minQueryChunk) {
				chunkStart = idx;
			} else {
				chunkEnd++;
				continue;
			}
		}

		for (chunkEnd = chunkStart; chunkEnd < normalizedFieldLen; chunkEnd++) {
			if (normalizedField[chunkEnd] !== queryChar) break;
			queryIdx++;
			queryChar = normalizedQuery[queryIdx];
		}

		chunkEnd--;
		chunks.push([chunkStart, chunkEnd]);

		if (queryIdx === normalizedQuery.length) {
			return scoreConsecutiveLetters(chunks, normalizedField);
		}
	}
	return null;
};
