import type { HighlightRanges } from "./types";

/**
 * Match density for one field's highlight ranges: matched characters divided by
 * the inclusive span they cover. 1 = a single solid run; lower = more scattered.
 * A cheap discriminator for junk fuzzy chains over long text. Empty ranges → 0.
 *
 * Expects ascending, non-overlapping ranges (as produced by this library).
 */
export const matchDensity = (ranges: HighlightRanges): number => {
	if (ranges.length === 0) return 0;
	let matched = 0;
	for (const [start, end] of ranges) matched += end - start + 1;
	const span = ranges[ranges.length - 1]![1] - ranges[0]![0] + 1;
	return span > 0 ? matched / span : 0;
};
