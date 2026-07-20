/**
 * The fuzzy fallback tier: assemble a query out of consecutive-letter chunks
 * found in the item, and score the assembly (fewer, cleaner chunks = lower =
 * better). `smart` only accepts chunks that start at a word boundary or run
 * 3+ characters; `aggressive` accepts any in-order subsequence.
 */

import {
	isValidWordBoundary,
} from "./shared";
import type { HighlightRanges } from "./types";

const SCORES = {
	BASE: 2,
	CHUNK_WHOLE_WORD: 0.2,
	CHUNK_WORD_START: 0.4,
	CHUNK_LONG: 0.8,
	CHUNK_SCATTERED: 1.6,
} as const;

const scoreConsecutiveLetters = (
	indices: HighlightRanges,
	normalizedItem: string,
): [number, HighlightRanges] => {
	let score = SCORES.BASE;
	for (const [firstIdx, lastIdx] of indices) {
		const chunkLength = lastIdx - firstIdx + 1;
		const isStartOfWord = firstIdx === 0 || normalizedItem[firstIdx - 1] === " ";
		const isEndOfWord =
			lastIdx === normalizedItem.length - 1 || normalizedItem[lastIdx + 1] === " ";
		if (isStartOfWord && isEndOfWord) score += SCORES.CHUNK_WHOLE_WORD;
		else if (isStartOfWord) score += SCORES.CHUNK_WORD_START;
		else if (chunkLength >= 3) score += SCORES.CHUNK_LONG;
		else score += SCORES.CHUNK_SCATTERED;
	}
	return [score, indices];
};

export const aggressiveFuzzyMatch = (
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

export const smartFuzzyMatch = (
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
