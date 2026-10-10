import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function makeSession(id: number): SessionInfo {
	return {
		path: `/tmp/session-${id}.jsonl`,
		id: `s${id}`,
		cwd: "/tmp/project",
		created: new Date(0),
		modified: new Date(Date.now() - id * 60000),
		messageCount: id + 1,
		firstMessage: `message ${id}`,
		allMessagesText: `message ${id}`,
	};
}

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

describe("session selector clamp and overflow search", () => {
	beforeAll(() => initTheme("dark"));
	beforeEach(() => setKeybindings(new KeybindingsManager()));

	it("clamps visible rows with selectListHeight", async () => {
		const sessions = Array.from({ length: 40 }, (_, i) => makeSession(i));
		const selector = new SessionSelectorComponent(
			async () => sessions,
			async () => [],
			() => {},
			() => {},
			() => {},
			() => {},
			{ keybindings: new KeybindingsManager() },
			undefined,
			24,
		);
		await flushPromises();
		const rendered = stripAnsi(selector.getSessionList().render(100).join("\n"));
		expect(rendered).toContain("more");
	});

	it("hides the search row when the list fits", async () => {
		const selector = new SessionSelectorComponent(
			async () => [makeSession(0)],
			async () => [],
			() => {},
			() => {},
			() => {},
			() => {},
			{ keybindings: new KeybindingsManager() },
		);
		await flushPromises();
		const rendered = stripAnsi(selector.getSessionList().render(100).join("\n"));
		expect(rendered).not.toContain("Type to search");
	});
});
