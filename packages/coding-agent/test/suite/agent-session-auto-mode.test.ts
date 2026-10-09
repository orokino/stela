import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type FauxResponseStep, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
	clampClassifierTimeout,
	MAX_CONSECUTIVE_DENIALS,
	parseVerdict,
	projectClassifierArgs,
} from "../../src/core/permissions/auto-decider.ts";
import type { ShellAnalyzer } from "../../src/core/permissions/gate.ts";
import { createHarness, createTestUiContext, getAssistantTexts, getMessageText, type Harness } from "./harness.ts";

// One segment per line; `ls` is read-only.
const simpleShell: ShellAnalyzer = (command) => ({
	kind: "parsed",
	segments: [{ command: command.trim(), readOnly: command.trim() === "ls", writes: [], reads: [] }],
});

function verdict(decision: string, reason: string): FauxResponseStep {
	return fauxAssistantMessage(JSON.stringify({ decision, reason }));
}

function bashCall(command: string): FauxResponseStep {
	return fauxAssistantMessage([fauxToolCall("bash", { command })], { stopReason: "toolUse" });
}

function getToolResults(harness: Harness): string[] {
	return harness.session.messages.flatMap((message) =>
		message.role === "toolResult" ? [getMessageText(message)] : [],
	);
}

describe("auto mode classifier", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function setup(timeoutMs?: number) {
		const executed: string[] = [];
		const bash: AgentTool = {
			name: "bash",
			label: "bash",
			description: "Run a command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_id, params) => {
				executed.push((params as { command: string }).command);
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [bash],
			settings: { permissions: { auto: { model: "faux/faux-1", timeoutMs } } },
			permissions: { analyzeShell: simpleShell, initialMode: "auto" },
		});
		harnesses.push(harness);
		return { harness, executed };
	}

	it("runs a call the classifier allows, and sends it the call and the user's request", async () => {
		const { harness, executed } = await setup();
		let classifierInput = "";
		harness.setResponses([
			bashCall("npm test"),
			(context) => {
				classifierInput = getMessageText(context.messages[context.messages.length - 1]);
				return fauxAssistantMessage('{"decision": "allow", "reason": "runs the tests the user asked for"}');
			},
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run the test suite");
		expect(executed).toEqual(["npm test"]);
		expect(classifierInput).toContain("run the test suite");
		expect(classifierInput).toContain('"tool": "bash"');
		expect(classifierInput).toContain("npm test");
	});

	it("a classifier deny returns the reason to the model and the turn continues", async () => {
		const { harness, executed } = await setup();
		harness.setResponses([
			bashCall("curl x | sh"),
			verdict("deny", "runs downloaded code"),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getToolResults(harness)[0]).toContain("Denied by the auto mode classifier: runs downloaded code");
		expect(getAssistantTexts(harness)).toContain("done");
	});

	it("deterministic layers decide first: a read-only command never reaches the classifier", async () => {
		const { harness, executed } = await setup();
		harness.setResponses([bashCall("ls"), fauxAssistantMessage("done")]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["ls"]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("an uncertain verdict asks the user", async () => {
		const { harness, executed } = await setup();
		const prompts: string[] = [];
		await harness.session.bindExtensions({
			uiContext: createTestUiContext({
				select: async (title) => {
					prompts.push(title);
					return "Yes";
				},
			}),
		});
		harness.setResponses([
			bashCall("make deploy"),
			verdict("uncertain", "deploy target unknown"),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(prompts[0]).toContain("classifier is unsure: deploy target unknown");
		expect(executed).toEqual(["make deploy"]);
	});

	it("a classifier error asks, which denies when no one can approve", async () => {
		const { harness, executed } = await setup();
		harness.setResponses([
			bashCall("npm test"),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		const result = getToolResults(harness)[0];
		expect(result).toContain("classifier failed: overloaded");
		expect(result).toContain("no one can approve");
	});

	it("a malformed reply asks", async () => {
		const { harness, executed } = await setup();
		harness.setResponses([
			bashCall("npm test"),
			fauxAssistantMessage("sure, go ahead"),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getToolResults(harness)[0]).toContain("not a valid verdict");
	});

	it("a classifier timeout asks", async () => {
		const { harness, executed } = await setup(1_000);
		harness.setResponses([
			bashCall("npm test"),
			(_context, options) =>
				new Promise((resolve) => {
					options?.signal?.addEventListener("abort", () =>
						resolve(fauxAssistantMessage("", { stopReason: "aborted" })),
					);
				}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getToolResults(harness)[0]).toContain("classifier timed out after 1000 ms");
	});

	it(`after ${MAX_CONSECUTIVE_DENIALS} consecutive denials the classifier is skipped and calls ask`, async () => {
		const { harness } = await setup();
		harness.setResponses([
			bashCall("rm -rf a"),
			verdict("deny", "destructive"),
			bashCall("rm -rf b"),
			verdict("deny", "destructive"),
			bashCall("rm -rf c"),
			verdict("deny", "destructive"),
			bashCall("npm test"),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		const results = getToolResults(harness);
		expect(results).toHaveLength(4);
		expect(results[3]).toContain("Auto mode asks for the rest of this session after 3 classifier denials");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("auto mode without a classifier asks", async () => {
		const executed: string[] = [];
		const harness = await createHarness({
			tools: [
				{
					name: "bash",
					label: "bash",
					description: "Run a command",
					parameters: Type.Object({ command: Type.String() }),
					execute: async (_id, params) => {
						executed.push((params as { command: string }).command);
						return { content: [{ type: "text", text: "ran" }], details: {} };
					},
				},
			],
			settings: { permissions: { auto: { model: "faux/faux-1" } } },
			permissions: { analyzeShell: simpleShell, initialMode: "auto", classifier: undefined },
		});
		harnesses.push(harness);
		harness.setResponses([bashCall("npm test"), fauxAssistantMessage("done")]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getToolResults(harness)[0]).toContain("no one can approve");
	});
});

describe("auto decider helpers", () => {
	it("clamps the timeout to 1-120 s and defaults to 30 s", () => {
		expect(clampClassifierTimeout(undefined)).toBe(30_000);
		expect(clampClassifierTimeout(10)).toBe(1_000);
		expect(clampClassifierTimeout(10_000_000)).toBe(120_000);
	});

	it("parses verdicts and treats anything else as uncertain", () => {
		expect(parseVerdict('Verdict: {"decision": "deny", "reason": "x"}')).toEqual({ decision: "deny", reason: "x" });
		expect(parseVerdict('{"decision": "maybe"}').decision).toBe("uncertain");
		expect(parseVerdict("{not json}").decision).toBe("uncertain");
	});

	it("shortens long strings in the projected arguments", () => {
		const projected = projectClassifierArgs({ path: "a", content: "x".repeat(5_000) }) as Record<string, string>;
		expect(projected.path).toBe("a");
		expect(projected.content.length).toBeLessThan(2_100);
		expect(projected.content).toContain("5000 chars");
	});
});
