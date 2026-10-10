import type { Terminal } from "@earendil-works/pi-tui";
import { notificationSequence } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { Notifier } from "../src/modes/interactive/notifier.ts";

function fakeTerminal(focused: boolean, writes: string[]): Terminal {
	return {
		notify: (message: string) => writes.push(`OSC9:${message}`),
		isTerminalFocused: () => focused,
	} as unknown as Terminal;
}

describe("notifier", () => {
	it("is silent when off", () => {
		const writes: string[] = [];
		const notifier = new Notifier(
			() => fakeTerminal(false, writes),
			() => "off",
			() => false,
		);
		notifier.notify("turn-complete");
		expect(writes).toEqual([]);
	});

	it("notifies once per turn while unfocused", () => {
		const writes: string[] = [];
		const notifier = new Notifier(
			() => fakeTerminal(false, writes),
			() => "auto",
			() => false,
		);
		notifier.notify("turn-complete");
		notifier.notify("error");
		expect(writes).toHaveLength(1);
		notifier.turnStarted();
		notifier.notify("error", "boom");
		expect(writes).toHaveLength(2);
		expect(writes[1]).toContain("boom");
	});

	it("stays quiet while focused unless opted in", () => {
		const writes: string[] = [];
		const notifier = new Notifier(
			() => fakeTerminal(true, writes),
			() => "auto",
			() => false,
		);
		notifier.notify("turn-complete");
		expect(writes).toEqual([]);
		const loud = new Notifier(
			() => fakeTerminal(true, writes),
			() => "auto",
			() => true,
		);
		loud.notify("turn-complete");
		expect(writes).toHaveLength(1);
	});

	it("builds a sanitized OSC 9 sequence with BEL fallback", () => {
		expect(notificationSequence("Stela done")).toBe("\x1b]9;Stela done\x07");
		expect(notificationSequence("a\nb")).toBe("\x1b]9;a b\x07");
		expect(notificationSequence("x", false)).toBe("\x07");
		expect(notificationSequence("y".repeat(300)).length).toBeLessThanOrEqual(240 + 10);
	});
});
