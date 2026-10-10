import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { OAuthSelectorComponent } from "../src/modes/interactive/components/oauth-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function makeProviders(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: `provider-${i}`,
		name: `Provider ${i}`,
		authType: "api_key" as const,
	}));
}

describe("OAuthSelectorComponent picker clamp", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("clamps visible rows with selectListHeight and shows overflow counts", () => {
		const selector = new OAuthSelectorComponent(
			"login",
			makeProviders(30),
			() => {},
			() => {},
			undefined,
			24,
		);
		const output = stripAnsi(selector.render(100).join("\n"));
		// clamp(24) = 12 visible rows; remainder surfaces as overflow grammar.
		expect(output).toContain("more");
		const rowCount = output.split("\n").filter((line) => line.includes("Provider")).length;
		expect(rowCount).toBe(12);
	});

	it("renders a live-keybinding footer that follows rebinding", () => {
		const selector = new OAuthSelectorComponent(
			"login",
			makeProviders(2),
			() => {},
			() => {},
		);
		expect(stripAnsi(selector.render(100).join("\n"))).toContain("enter select");
		setKeybindings(new KeybindingsManager({ "tui.select.confirm": "ctrl+m" }));
		const rebound = new OAuthSelectorComponent(
			"login",
			makeProviders(2),
			() => {},
			() => {},
		);
		expect(stripAnsi(rebound.render(100).join("\n"))).toContain("ctrl+m select");
	});

	it("shows the search row only on overflow", () => {
		const small = new OAuthSelectorComponent(
			"login",
			makeProviders(2),
			() => {},
			() => {},
		);
		const big = new OAuthSelectorComponent(
			"login",
			makeProviders(30),
			() => {},
			() => {},
		);
		expect(stripAnsi(small.render(100).join("\n"))).not.toContain("more");
		expect(stripAnsi(big.render(100).join("\n"))).toContain("more");
	});
});
