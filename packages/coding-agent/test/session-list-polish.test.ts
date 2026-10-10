import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { SessionInfo } from "../src/core/session-manager.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function makeSession(id: number, modified: Date): SessionInfo {
	return {
		path: `/tmp/session-${id}.jsonl`,
		id: `s${id}`,
		cwd: "/tmp/project",
		created: new Date(0),
		modified,
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

describe("session list polish", () => {
	beforeAll(() => initTheme("dark"));
	beforeEach(() => setKeybindings(new KeybindingsManager()));

	it("renders 200 sessions with the shared overflow grammar", async () => {
		const sessions = Array.from({ length: 200 }, (_, i) => makeSession(i, new Date(Date.now() - i * 60000)));
		const selector = new SessionSelectorComponent(
			async () => sessions,
			async () => [],
			() => {},
			() => {},
			() => {},
			() => {},
			{ keybindings: new KeybindingsManager() },
		);
		await flushPromises();
		const rendered = stripAnsi(selector.getSessionList().render(100).join("\n"));
		expect(rendered).toContain("❯ ");
		expect(rendered).toContain("↓ ");
		expect(rendered).toContain("more");
		expect(rendered.replace(/_pi:.*?/g, "")).toContain("Type to search");
	});

	it("uses relative dates for session age", async () => {
		const now = Date.now();
		const sessions = [
			makeSession(0, new Date(now - 30_000)),
			makeSession(1, new Date(now - 5 * 60000)),
			makeSession(2, new Date(now - 3 * 3600000)),
			makeSession(3, new Date(now - 2 * 86400000)),
		];
		const selector = new SessionSelectorComponent(
			async () => sessions,
			async () => [],
			() => {},
			() => {},
			() => {},
			() => {},
			{ keybindings: new KeybindingsManager() },
		);
		await flushPromises();
		const rendered = stripAnsi(selector.getSessionList().render(100).join("\n"));
		expect(rendered).toContain("now");
		expect(rendered).toContain("5m");
		expect(rendered).toContain("3h");
		expect(rendered).toContain("2d");
	});
});
