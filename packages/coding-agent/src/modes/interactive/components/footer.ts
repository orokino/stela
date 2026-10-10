import { isAbsolute, relative, resolve, sep } from "node:path";
import { type Component, pickSymbol, spinnerFrames, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ContextUsage } from "../../../core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { addUsageToTotals, createUsageTotals, type UsageTotals } from "../../../core/usage-totals.ts";
import { stripAnsi } from "../../../utils/ansi.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/**
 * Context-window state for the footer's context segment. Thresholds match the existing colour
 * bands (70/90%); the level drives glyph + word + colour so the warning reads without colour.
 */
export type ContextLevel = "ok" | "high" | "critical";

export function contextLevelForPercent(percent: number): ContextLevel {
	if (percent > 90) return "critical";
	if (percent > 70) return "high";
	return "ok";
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

interface SessionStats {
	session: AgentSession;
	sessionId: string;
	leafId: string | null;
	entryCount: number;
	limitsModel: unknown;
	usageTotals: UsageTotals;
	latestCacheHitRate: number | undefined;
	filesEdited: number;
	contextUsage: ContextUsage | undefined;
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private showExtendedTelemetry = false;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;
	private sessionStats?: SessionStats;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	setShowExtendedTelemetry(show: boolean): void {
		this.showExtendedTelemetry = show;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	/**
	 * Usage totals and context usage scan the whole session, and the footer renders on every frame.
	 * Entries are append-only and every append moves the leaf, so the results only change with the
	 * session, leaf, entry count, or the model whose context window applies.
	 */
	private getSessionStats(): SessionStats {
		const sessionManager = this.session.sessionManager;
		const entryCount = sessionManager.getEntryCount();
		const sessionId = sessionManager.getSessionId();
		const leafId = sessionManager.getLeafId();
		const limitsModel = this.session.routedModel?.model ?? this.session.model;
		const cached = this.sessionStats;
		if (
			cached &&
			cached.session === this.session &&
			cached.sessionId === sessionId &&
			cached.leafId === leafId &&
			cached.entryCount === entryCount &&
			cached.limitsModel === limitsModel
		) {
			return cached;
		}

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		const usageTotals = createUsageTotals();
		let latestCacheHitRate: number | undefined;
		const editedPaths = new Set<string>();

		for (const entry of sessionManager.getEntries()) {
			if (entry.type === "usage") {
				addUsageToTotals(usageTotals, entry.usage);
			} else if (entry.type === "message" && entry.message.role === "assistant") {
				addUsageToTotals(usageTotals, entry.message.usage);

				const latestPromptTokens =
					entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
				latestCacheHitRate =
					latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
				for (const block of entry.message.content ?? []) {
					if (typeof block !== "object" || block === null || block.type !== "toolCall") continue;
					if (!("name" in block) || (block.name !== "edit" && block.name !== "write")) continue;
					let editedPath: string | undefined;
					if ("arguments" in block && typeof block.arguments === "object" && block.arguments !== null) {
						if ("path" in block.arguments && typeof block.arguments.path === "string") {
							editedPath = block.arguments.path;
						}
					}
					editedPaths.add(editedPath && editedPath !== "" ? editedPath : `${block.name}:${editedPaths.size}`);
				}
			} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
				addUsageToTotals(usageTotals, entry.message.usage);
			} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
				addUsageToTotals(usageTotals, entry.usage);
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		this.sessionStats = {
			session: this.session,
			sessionId,
			leafId,
			entryCount,
			limitsModel,
			usageTotals,
			latestCacheHitRate,
			filesEdited: editedPaths.size,
			contextUsage,
		};
		return this.sessionStats;
	}

	render(width: number): string[] {
		const state = this.session.state;
		const { usageTotals, latestCacheHitRate, filesEdited, contextUsage } = this.getSessionStats();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Left segments, in drop priority order (first drops first):
		// extended telemetry suffix -> session name -> path shorten -> branch.
		// The context segment is pinned: it never drops.
		const cwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = this.footerData.getGitBranch();
		const sessionName = this.session.sessionManager.getSessionName();

		const showExtended =
			this.showExtendedTelemetry ||
			(typeof this.session.settingsManager?.getShowExtendedTelemetry === "function" &&
				this.session.settingsManager.getShowExtendedTelemetry());

		// Extended telemetry suffix (S5, CU fragment minus model): token counts, cache
		// hit rate, cost, files edited. Off by default; off keeps only the context segment.
		const telemetryParts: string[] = [];
		if (showExtended) {
			if (usageTotals.input) telemetryParts.push(`up ${formatTokens(usageTotals.input)}`);
			if (usageTotals.output) telemetryParts.push(`down ${formatTokens(usageTotals.output)}`);
			if (usageTotals.cacheRead) telemetryParts.push(`R${formatTokens(usageTotals.cacheRead)}`);
			if (usageTotals.cacheWrite) telemetryParts.push(`W${formatTokens(usageTotals.cacheWrite)}`);
			if ((usageTotals.cacheRead > 0 || usageTotals.cacheWrite > 0) && latestCacheHitRate !== undefined) {
				telemetryParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
			}
			const usingSubscription = state.model
				? state.model.provider === "kimi-coding" ||
					this.session.modelRuntime.isUsingSubscription(state.model.provider)
				: false;
			if (usageTotals.cost || usingSubscription) {
				telemetryParts.push(`$${usageTotals.cost.toFixed(2)}${usingSubscription ? " (sub)" : ""}`);
			}
			if (filesEdited > 0) telemetryParts.push(`${filesEdited} file${filesEdited === 1 ? "" : "s"}`);
		}

		// Context segment: `pct/window` glyph form. Above the bands the level adds
		// a word (`high`, `critical`) so the warning reads without colour; the auto-compact
		// marker keeps its glyph. Pinned: never truncated mid-word, never dropped.
		const autoIndicator = this.autoCompactEnabled ? ` ${pickSymbol("⟲", "(auto)")}` : "";
		const contextLevel = contextPercent === "?" ? "ok" : contextLevelForPercent(contextPercentValue);
		const contextWord = contextLevel === "ok" ? "" : contextLevel === "high" ? " high" : " critical";
		const contextMark = pickSymbol("◫", "ctx");
		const contextSegment =
			contextPercent === "?"
				? `${contextMark} ?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextMark} ${contextPercent}%/${formatTokens(contextWindow)}${contextWord}${autoIndicator}`;
		const contextSegmentColored =
			contextLevel === "critical"
				? theme.fg("error", contextSegment)
				: contextLevel === "high"
					? theme.fg("warning", contextSegment)
					: contextSegment;

		// Right slot: while streaming the Working slot (elapsed + live interrupt hint)
		// replaces the telemetry suffix; otherwise the suffix shows when opted in.
		const rightSuffix = this.session.isStreaming
			? `${spinnerFrames()[0]} Working (${keyText("app.interrupt")} to interrupt)`
			: telemetryParts.join(" · ");

		const joiner = " · ";
		const location = branch ? `${cwd} (${branch})` : cwd;
		const candidates: Array<{ text: string; drop: number }> = [
			{ text: location, drop: 3 },
			...(sessionName ? [{ text: sessionName, drop: 2 }] : []),
			...(rightSuffix ? [{ text: rightSuffix, drop: 1 }] : []),
		];

		const contextWidth = visibleWidth(contextSegment);
		const totalWidth = (segs: Array<{ text: string }>): number => {
			if (segs.length === 0) return contextWidth;
			return visibleWidth(segs.map((s) => s.text).join(joiner)) + visibleWidth(joiner) + contextWidth;
		};

		// Ordered segment drops: telemetry suffix -> session -> path-shorten -> branch.
		// The context segment is pinned: it never drops and is never truncated mid-word.
		const kept = [...candidates];
		while (kept.length > 0 && totalWidth(kept) > width) {
			const suffixIndex = kept.findIndex((s) => s.drop === 1);
			if (suffixIndex >= 0) {
				kept.splice(suffixIndex, 1);
				continue;
			}
			const sessionIndex = kept.findIndex((s) => s.drop === 2);
			if (sessionIndex >= 0) {
				kept.splice(sessionIndex, 1);
				continue;
			}
			const locationIndex = kept.findIndex((s) => s.drop === 3);
			if (locationIndex >= 0) {
				const text = kept[locationIndex]!.text;
				if (text.length > 8 && visibleWidth(text) > 8) {
					const shortened = truncateToWidth(text, 8, "...");
					if (visibleWidth(shortened) < visibleWidth(text)) {
						kept[locationIndex] = { text: shortened, drop: 3 };
						if (totalWidth(kept) <= width) break;
					}
				}
				kept.splice(locationIndex, 1);
				continue;
			}
			break;
		}

		let line: string;
		if (kept.length === 0) {
			// Only the pinned context segment fits (or nothing does): never truncate mid-word.
			line = contextWidth <= width ? contextSegmentColored : truncateToWidth(contextSegmentColored, width, "");
		} else {
			const left = kept.map((s) => s.text).join(joiner);
			if (totalWidth(kept) <= width) {
				line = `${left}${" ".repeat(Math.max(1, width - totalWidth(kept)))}${contextSegmentColored}`;
			} else {
				// Narrow: single row, segments joined; context stays whole at the end.
				line = `${left}${joiner}${contextSegmentColored}`;
				if (visibleWidth(stripAnsi(line)) > width) line = contextSegmentColored;
			}
		}

		const dimmed = theme.fg("dim", line);
		const lines = [dimmed];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
