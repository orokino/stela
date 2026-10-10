/**
 * Per-surface truncation table: collapsed/expanded row budgets for every transcript surface.
 * Stolen from OMP's limits table (OMP U14: COLLAPSED_LINES 3, EXPANDED_LINES 12, OUTPUT_COLLAPSED 3,
 * OUTPUT_EXPANDED 10, DIFF_COLLAPSED_HUNKS 8, DIFF_COLLAPSED_LINES 40) with OC's shell 10-line cap
 * (OC U14) and read's 10-line preview kept. Collapsed bodies end with the standard
 * `… N more lines` + expand-hint affordance.
 */
export const TRUNCATION_TABLE = {
	/** Generic collapsed tool body. */
	bodyCollapsed: 3,
	/** Generic expanded tool body. */
	bodyExpanded: 12,
	/** Shell output, collapsed (tail). */
	outputCollapsed: 3,
	/** Shell output, expanded. */
	outputExpanded: 10,
	/** Shell preview rows while collapsed (OC: 10 lines). */
	shellCollapsed: 10,
	/** Read/grep/find/ls result preview rows. */
	listCollapsed: 10,
	/** Search result preview rows. */
	searchCollapsed: 15,
	/** Find/ls result preview rows. */
	findCollapsed: 20,
	/** Fallback renderer preview rows. */
	fallbackCollapsed: 10,
	/** Diff hunks kept while collapsed. */
	diffHunks: 8,
	/** Diff rows kept while collapsed. */
	diffLines: 40,
} as const;

export type TruncationSurface = keyof typeof TRUNCATION_TABLE;
