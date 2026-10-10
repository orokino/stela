import { setSymbolPreset } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TaskHudComponent } from "../src/modes/interactive/components/task-hud.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("task HUD", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => setSymbolPreset("unicode"));

	it("renders nothing without shells", () => {
		const hud = new TaskHudComponent(1);
		expect(stripAnsi(hud.render(80).join("\n")).trim()).toBe("");
	});

	it("caps at 3 rows with an overflow tail", () => {
		const hud = new TaskHudComponent(1);
		const now = Date.now();
		hud.setShells(
			Array.from({ length: 5 }, (_, i) => ({ name: `shell ${i + 1}`, command: `sleep ${i}`, startedAt: now })),
		);
		const rendered = stripAnsi(hud.render(80).join("\n"));
		expect(rendered).toContain("shell 3");
		expect(rendered).not.toContain("shell 4");
		expect(rendered).toContain("… 2 more — expand");
		hud.setExpanded(true);
		expect(stripAnsi(hud.render(80).join("\n"))).toContain("shell 5");
	});

	it("warns after 5 seconds and speaks ASCII", () => {
		const hud = new TaskHudComponent(1);
		hud.setShells([{ name: "shell 1", command: "sleep 30", startedAt: Date.now() - 6000 }]);
		expect(stripAnsi(hud.render(80).join("\n"))).toContain("⏹ shell 1 sleep 30 · 6s");
		setSymbolPreset("ascii");
		expect(stripAnsi(hud.render(80).join("\n"))).toContain("[bg] shell 1 sleep 30 / 6s");
	});

	it("keeps a Finished row for background completions only", () => {
		const hud = new TaskHudComponent(1);
		hud.addFinished("sleep 6");
		const rendered = stripAnsi(hud.render(80).join("\n"));
		expect(rendered).toContain('Finished "sleep 6"');
		// Foreground `!` shells surface completion through their tool card, so the
		// caller (handleBashCommand) only calls addFinished for `!!` shells.
		hud.addFinished("sleep 7");
		hud.addFinished("sleep 8");
		hud.addFinished("sleep 9");
		const capped = stripAnsi(hud.render(80).join("\n"));
		expect(capped).not.toContain('Finished "sleep 6"');
		expect(capped).toContain('Finished "sleep 9"');
	});
});
