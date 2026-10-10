import { pickSymbol } from "@earendil-works/pi-tui";

/**
 * Transcript row glyphs. The shape carries the row kind so notices, warnings, and errors survive a
 * no-colour terminal; colour only reinforces them. User rows are a tinted block (Cursor: CU U3);
 * assistant text stays plain. Matches the phase-1 study.
 */
export const MESSAGE_GLYPHS = {
	notice: "ⓘ",
	warning: "⚠",
	error: "■",
} as const;

export type MessageKind = keyof typeof MESSAGE_GLYPHS;

/** ASCII stand-ins for terminals without the Unicode glyphs. */
export const MESSAGE_GLYPHS_ASCII: Record<MessageKind, string> = {
	notice: "i",
	warning: "!",
	error: "x",
};

/** Row glyph in the active symbol preset. */
export function messageGlyph(kind: MessageKind): string {
	return pickSymbol(MESSAGE_GLYPHS[kind], MESSAGE_GLYPHS_ASCII[kind]);
}

/**
 * Duration label for a finished thinking run, in the `Thought · <duration>`
 * collapse. Whole seconds below a minute, `Xm Ys` above; sub-second runs show
 * `<1s` so the label never claims a precision the clock cannot give.
 *
 * Label synthesis (S8): the collapsed line reads `Thought · <duration> · <N>
 * line(s) · <key> to expand`. The count + key text are grafted from CU's
 * affordance (cursor-agent.md U3) onto OC's one-line shape (opencode.md U3);
 * neither target ships this exact line. See `formatThoughtCollapsed`.
 */
export function formatThoughtDuration(durationMs: number | undefined): string {
	if (durationMs === undefined || durationMs < 0) return "Thought";
	if (durationMs < 1000) return "Thought · <1s";
	const totalSeconds = Math.floor(durationMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `Thought · ${seconds}s`;
	return `Thought · ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/** Live thinking row while a run is still streaming: `Thinking… <elapsed>`. */
export function formatThinkingLive(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `Thinking… ${seconds}s`;
	return `Thinking… ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/**
 * Collapsed thinking line (S8 synthesis): `Thought · <duration> · <N> lines ·
 * <key> to expand`. The duration word comes from the finished-run label;
 * the count + key are CU's affordance grafted onto OC's one-line shape. `key`
 * is the live-resolved `app.tools.expand` label so the hint can never go stale.
 */
export function formatThoughtCollapsed(duration: string, hiddenLines: number, key: string): string {
	const lines = `${hiddenLines} line${hiddenLines === 1 ? "" : "s"}`;
	return `+ Thought · ${duration} · ${lines} · ${key} to expand`;
}

/** Duration word for the collapsed line without the `Thought · ` prefix. */
export function formatThoughtCollapsedDuration(durationMs: number | undefined): string {
	if (durationMs === undefined || durationMs < 0) return "--";
	return formatThoughtDuration(durationMs).replace(/^Thought · /, "");
}

/**
 * Transcript meta line (S7): `duration · tok/s` only. The model lives on the
 * composer bottom border, so repeating it here would print it 3x/turn. tok/s is
 * tokens per wall second from usage totals; when either input is missing the
 * line degrades to the bare duration instead of guessing.
 */
export function formatTurnMetaLine(durationMs: number | undefined, totalTokens: number | undefined): string {
	const seconds = durationMs !== undefined && durationMs >= 0 ? durationMs / 1000 : undefined;
	const duration =
		seconds === undefined ? "--" : seconds < 60 ? `${seconds.toFixed(1)}s` : formatLongDuration(seconds);
	if (totalTokens === undefined || seconds === undefined || seconds <= 0) return duration;
	return `${duration} · ${(totalTokens / seconds).toFixed(1)} tok/s`;
}

function formatLongDuration(seconds: number): string {
	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m ${remainder.toString().padStart(2, "0")}s`;
}
