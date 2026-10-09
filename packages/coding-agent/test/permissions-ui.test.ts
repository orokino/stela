import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ExtensionUIDialogOptions } from "../src/core/extensions/types.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { KEYBINDINGS } from "../src/core/keybindings.ts";
import type { PermissionMode } from "../src/core/permissions/modes.ts";
import { createUIPermissionPrompter } from "../src/core/permissions/permission-prompt.ts";
import { FooterComponent } from "../src/modes/interactive/components/footer.ts";
import { PermissionModeSelectorComponent } from "../src/modes/interactive/components/permission-mode-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function session(mode: PermissionMode | undefined): AgentSession {
	return {
		state: { model: { id: "m", provider: "p", contextWindow: 1000, reasoning: false }, thinkingLevel: "off" },
		sessionManager: {
			getEntries: () => [],
			getEntryCount: () => 0,
			getSessionId: () => "s",
			getLeafId: () => null,
			getSessionName: () => undefined,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 1000, percent: 1 }),
		modelRuntime: { isUsingSubscription: () => false },
		permissions: mode ? { mode } : undefined,
	} as unknown as AgentSession;
}

const footerData: ReadonlyFooterDataProvider = {
	getGitBranch: () => null,
	getExtensionStatuses: () => new Map<string, string>(),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
};

function statsLine(mode: PermissionMode | undefined): string {
	return stripAnsi(new FooterComponent(session(mode), footerData).render(120)[1] ?? "");
}

describe("permission modes UI", () => {
	beforeAll(() => initTheme(undefined, false));

	it("binds Shift+Tab to the permission cycle and Alt+T to thinking", () => {
		expect(KEYBINDINGS["app.permissions.cycle"].defaultKeys).toBe("shift+tab");
		expect(KEYBINDINGS["app.thinking.cycle"].defaultKeys).toBe("alt+t");
	});

	it("shows the mode first on the footer stats line", () => {
		expect(statsLine("manual").startsWith("manual ")).toBe(true);
		expect(statsLine("bypassPermissions").startsWith("bypass permissions ")).toBe(true);
		expect(statsLine(undefined)).not.toContain("manual");
	});

	it("lists every mode and explains unavailable ones", () => {
		const selected: PermissionMode[] = [];
		const selector = new PermissionModeSelectorComponent(
			"plan",
			{ autoAvailable: false, bypassAvailable: true },
			(mode) => selected.push(mode),
			() => {},
		);
		const text = stripAnsi(selector.render(120).join("\n"));
		for (const label of ["manual", "accept edits", "plan", "auto", "bypass permissions"]) {
			expect(text).toContain(label);
		}
		expect(text).toContain("✓ plan");
		expect(text).toContain("unavailable: set permissions.auto.model");
		selector.handleInput("\r");
		expect(selected).toEqual(["plan"]);
	});

	it("marks the approval dialog and its feedback input as permission dialogs", async () => {
		const kinds: Array<ExtensionUIDialogOptions["kind"]> = [];
		const prompter = createUIPermissionPrompter({
			select: async (_title, _options, opts) => {
				kinds.push(opts?.kind);
				return "No, and tell the model why";
			},
			input: async (_title, _placeholder, opts) => {
				kinds.push(opts?.kind);
				return "use git status";
			},
		});
		const answer = await prompter({
			toolName: "bash",
			summary: "git push",
			reason: "No permission rule allows this call.",
			suggestedRules: ["Bash(git push)"],
			ruleChoices: [],
			canSaveToProject: false,
			canAcceptEdits: false,
		});
		expect(answer).toEqual({ kind: "deny", feedback: "use git status" });
		expect(kinds).toEqual(["permission", "permission"]);
	});
});
