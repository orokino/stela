import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function makeConfig(): SettingsConfig {
	return {
		autoCompact: false,
		defaultModel: "not set",
		availableDefaultModels: [],
		showImages: false,
		imageWidthCells: 60,
		autoResizeImages: true,
		blockImages: false,
		enableSkillCommands: true,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		transport: "auto",
		httpIdleTimeoutMs: 300000,
		cacheWarmingMode: "streaming",
		thinkingLevel: "medium",
		availableThinkingLevels: [],
		modelThinkingLevels: {},
		currentTheme: "dark",
		terminalTheme: "dark",
		availableThemes: ["dark"],
		hideThinkingBlock: false,
		mermaidRenderingMode: "streaming",
		showCacheMissNotices: false,
		collapseChangelog: false,
		enableInstallTelemetry: true,
		doubleEscapeAction: "tree",
		treeFilterMode: "default",
		showHardwareCursor: false,
		editorPaddingX: 0,
		outputPad: 1,
		autocompleteMaxVisible: 8,
		quietStartup: false,
		defaultProjectTrust: "ask",
		clearOnShrink: false,
		showTerminalProgress: false,
		animationsEnabled: true,
		symbolPreset: "unicode",
		notificationMode: "off",
		notifyWhenFocused: false,
		fullscreenMouse: false,
		tuiMode: "regular",
		fullscreenExitOutput: "transcript",
		fullscreenScrollbar: "auto",
		fullscreenCopyOnSelect: true,
		fullscreenWheelScrollLines: "auto",
		warnings: {},
	} as SettingsConfig;
}

describe("SettingsSelectorComponent pager shell", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("exposes terminal/notification/mouse pager entries", () => {
		const callbacks = { onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(makeConfig(), callbacks).getSettingsList();
		const search = (label: string): void => {
			for (const character of label) list.handleInput(character);
		};
		for (const label of [
			"Terminal animations",
			"Terminal symbols",
			"Notification mode",
			"Notify when focused",
			"Fullscreen mouse",
		]) {
			const fresh = new SettingsSelectorComponent(makeConfig(), callbacks).getSettingsList();
			for (const character of label) fresh.handleInput(character);
			expect(stripAnsi(fresh.render(120).join("\n"))).toContain(label);
			search(label.slice(0, 3));
		}
	});

	it("cycles the pager entries through their values", () => {
		const onAnimations = vi.fn();
		const onSymbols = vi.fn();
		const onNotificationMode = vi.fn();
		const onNotifyFocused = vi.fn();
		const onMouse = vi.fn();
		const callbacks = {
			onAnimationsEnabledChange: onAnimations,
			onSymbolPresetChange: onSymbols,
			onNotificationModeChange: onNotificationMode,
			onNotifyWhenFocusedChange: onNotifyFocused,
			onFullscreenMouseChange: onMouse,
			onCancel: () => {},
		} as unknown as SettingsCallbacks;
		const cycle = (label: string, count: number): void => {
			const list = new SettingsSelectorComponent(makeConfig(), callbacks).getSettingsList();
			for (const character of label) list.handleInput(character);
			for (let i = 0; i < count; i++) list.handleInput("\r");
		};
		cycle("Terminal animations", 1);
		expect(onAnimations.mock.calls.flat()).toEqual([false]);
		cycle("Terminal symbols", 1);
		expect(onSymbols.mock.calls.flat()).toEqual(["ascii"]);
		cycle("Notification mode", 1);
		expect(onNotificationMode.mock.calls.flat()).toEqual(["auto"]);
		cycle("Notify when focused", 1);
		expect(onNotifyFocused.mock.calls.flat()).toEqual([true]);
		cycle("Fullscreen mouse", 1);
		expect(onMouse.mock.calls.flat()).toEqual([true]);
	});
});
