import { visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import {
	contextLevelForPercent,
	FooterComponent,
	formatCwdForFooter,
} from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
	branchUsage?: AssistantUsage;
	compactionUsage?: AssistantUsage;
	toolUsage?: AssistantUsage;
	usingSubscription?: boolean;
	routedModel?: { model: { id: string }; thinkingLevel?: string };
	contextPercent?: number;
	isStreaming?: boolean;
}): AgentSession {
	const usage = options.usage;
	const entries: Array<Record<string, unknown>> = [];

	if (usage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "assistant",
				usage,
			},
		});
	}

	if (options.branchUsage !== undefined) {
		entries.push({
			type: "branch_summary",
			usage: options.branchUsage,
		});
	}

	if (options.compactionUsage !== undefined) {
		entries.push({
			type: "compaction",
			usage: options.compactionUsage,
		});
	}

	if (options.toolUsage !== undefined) {
		entries.push({
			type: "message",
			message: {
				role: "toolResult",
				usage: options.toolUsage,
			},
		});
	}

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getEntryCount: () => entries.length,
			getSessionId: () => "test-session",
			getLeafId: () => null,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: options.contextPercent ?? 12.3 }),
		isStreaming: options.isStreaming ?? false,
		routedModel: options.routedModel,
		modelRuntime: {
			isUsingSubscription: () => options.usingSubscription ?? false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

describe("FooterComponent one-row ladder", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	function renderOneRow(session: AgentSession, providerCount: number, width: number): string {
		const footer = new FooterComponent(session, createFooterData(providerCount));
		footer.setShowExtendedTelemetry(true);
		const lines = footer.render(width);
		expect(lines.length).toBe(1);
		return stripAnsi(lines[0] ?? "");
	}

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		expect(lines.length).toBe(1);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		expect(lines.length).toBe(1);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("renders a single row with no model, mode, or hints", () => {
		const session = createSession({ sessionName: "fix-footer" });
		const line = renderOneRow(session, 1, 120);
		expect(line).toContain("/tmp/project (main)");
		expect(line).toContain("fix-footer");
		expect(line).toContain("◫ 12.3%/200k");
		expect(line).not.toContain("test-model");
		expect(line).not.toContain("manual");
	});

	it("shows extended telemetry only when opted in", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.5 },
			},
			branchUsage: {
				input: 20,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.25 },
			},
			compactionUsage: {
				input: 5,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.125 },
			},
			toolUsage: {
				input: 15,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.375 },
			},
		});
		expect(renderOneRow(session, 1, 120)).toContain("$1.25");
		const off = stripAnsi(new FooterComponent(session, createFooterData(1)).render(120)[0] ?? "");
		expect(off).not.toContain("$");
		expect(off).toContain("◫ 12.3%/200k");
	});

	it("updates cached usage totals after an entry is appended", () => {
		const usage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } };
		const session = createSession({ sessionName: "", usage });
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setShowExtendedTelemetry(true);
		expect(stripAnsi(footer.render(120)[0] ?? "")).toContain("$0.50");

		session.sessionManager.getEntries().push({ type: "message", message: { role: "assistant", usage } } as never);
		expect(stripAnsi(footer.render(120)[0] ?? "")).toContain("$1.00");
	});

	it("shows the latest cache hit rate when cache usage is present", () => {
		const session = createSession({
			sessionName: "",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 50,
				cacheWrite: 50,
				cost: { total: 0.001 },
			},
		});
		expect(renderOneRow(session, 1, 120)).toContain("CH25.0%");
	});

	it("marks Kimi Coding costs as subscription estimates", () => {
		const session = createSession({
			sessionName: "",
			provider: "kimi-coding",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		expect(renderOneRow(session, 1, 120)).toContain("$1.23 (sub)");
	});

	it("marks explicitly identified subscription auth", () => {
		const session = createSession({ sessionName: "", provider: "anthropic", usingSubscription: true });
		expect(renderOneRow(session, 1, 120)).toContain("$0.00 (sub)");
	});

	it("does not mark generic OAuth sign-in as a subscription", () => {
		const session = createSession({
			sessionName: "",
			provider: "openrouter",
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const stats = renderOneRow(session, 1, 120);
		expect(stats).toContain("$1.23");
		expect(stats).not.toContain("(sub)");
	});

	it("counts distinct files edited", () => {
		const editUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } };
		const session = createSession({ sessionName: "" });
		session.sessionManager.getEntries().push({
			type: "message",
			message: {
				role: "assistant",
				usage: editUsage,
				content: [
					{ type: "toolCall", id: "1", name: "edit", arguments: { path: "a.txt" } },
					{ type: "toolCall", id: "2", name: "write", arguments: { path: "b.txt" } },
					{ type: "toolCall", id: "3", name: "edit", arguments: { path: "a.txt" } },
				],
			},
		} as never);
		expect(renderOneRow(session, 1, 120)).toContain("2 files");
	});

	it("encodes the context warning as glyph plus word, not colour alone", () => {
		const render = (percent: number): string => {
			const footer = new FooterComponent(
				createSession({ sessionName: "", contextPercent: percent }),
				createFooterData(1),
			);
			return stripAnsi(footer.render(120)[0] ?? "");
		};
		expect(render(12.3)).toContain("◫ 12.3%/200k");
		expect(render(12.3)).not.toContain("high");
		expect(render(75)).toContain("◫ 75.0%/200k high");
		expect(render(95)).toContain("◫ 95.0%/200k critical");
	});

	it("thresholds the context level at 70 and 90 percent", () => {
		expect(contextLevelForPercent(70)).toBe("ok");
		expect(contextLevelForPercent(70.1)).toBe("high");
		expect(contextLevelForPercent(90)).toBe("high");
		expect(contextLevelForPercent(90.1)).toBe("critical");
	});

	it("shows the running slot with the live interrupt hint while streaming", () => {
		const footer = new FooterComponent(
			createSession({ sessionName: "", modelId: "m1", isStreaming: true }),
			createFooterData(1),
		);
		const stats = stripAnsi(footer.render(120)[0] ?? "");
		expect(stats).toContain("Working");
		expect(stats).toContain("to interrupt");
		expect(stats).not.toContain("m1");
	});

	it("drops telemetry, then session, then path, keeping context pinned", () => {
		const session = createSession({ sessionName: "fix-footer" });
		const footer = new FooterComponent(session, createFooterData(1));
		footer.setShowExtendedTelemetry(true);
		const narrow = stripAnsi(footer.render(40)[0] ?? "");
		expect(narrow).toContain("◫ 12.3%/200k");
		expect(visibleWidth(narrow)).toBeLessThanOrEqual(40);
		const wide = renderOneRow(session, 1, 120);
		expect(wide).toContain("fix-footer");
	});

	it("keeps the context segment at 40 columns", () => {
		const footer = new FooterComponent(createSession({ sessionName: "", contextPercent: 42.5 }), createFooterData(1));
		const lines = footer.render(40).map((line) => stripAnsi(line));
		expect(lines.join("\n")).toContain("◫ 42.5%/200k");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});
});
