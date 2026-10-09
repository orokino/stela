import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ShellAnalyzer } from "../../src/core/permissions/gate.ts";
import type { Settings } from "../../src/core/settings-manager.ts";
import {
	createHarness,
	createTestUiContext,
	getAssistantTexts,
	getMessageText,
	getToolResult,
	type Harness,
} from "./harness.ts";

// Keeps these tests independent of the wasm parser: one segment per line, `ls` is read-only.
const simpleShell: ShellAnalyzer = (command) => ({
	kind: "parsed",
	segments: [{ command: command.trim(), readOnly: command.trim() === "ls", writes: [], reads: [] }],
});

describe("permission gate in AgentSession", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function setup(options: { settings?: Partial<Settings>; mode?: "manual" | "plan" } = {}) {
		const executed: string[] = [];
		const bash: AgentTool = {
			name: "bash",
			label: "bash",
			description: "Run a command",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_id, params) => {
				executed.push(`bash:${(params as { command: string }).command}`);
				return { content: [{ type: "text", text: "ran" }], details: {} };
			},
		};
		const write: AgentTool = {
			name: "write",
			label: "write",
			description: "Write a file",
			parameters: Type.Object({ path: Type.String(), content: Type.String() }),
			execute: async (_id, params) => {
				executed.push(`write:${(params as { path: string }).path}`);
				return { content: [{ type: "text", text: "written" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [bash, write],
			settings: options.settings,
			permissions: { analyzeShell: simpleShell, initialMode: options.mode },
		});
		harnesses.push(harness);
		return { harness, executed };
	}

	function respond(harness: Harness, ...calls: Array<[string, Record<string, string>]>) {
		harness.setResponses([
			...calls.map(([name, args]) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" })),
			fauxAssistantMessage("done"),
		]);
	}

	function bindUi(harness: Harness, answers: string[], input?: string) {
		const prompts: string[] = [];
		return harness.session
			.bindExtensions({
				uiContext: createTestUiContext({
					select: async (title) => {
						prompts.push(title);
						return answers.shift();
					},
					input: async () => input,
				}),
			})
			.then(() => prompts);
	}

	it("allows read-only commands without asking", async () => {
		const { harness, executed } = await setup();
		respond(harness, ["bash", { command: "ls" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["bash:ls"]);
	});

	it("denies with a reason and continues the turn when no one can approve", async () => {
		const { harness, executed } = await setup();
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getMessageText(getToolResult(harness, "bash"))).toContain("no one can approve");
		expect(getAssistantTexts(harness)).toContain("done");
	});

	it("runs the call once when the user says yes", async () => {
		const { harness, executed } = await setup();
		const prompts = await bindUi(harness, ["Yes"]);
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["bash:npm test"]);
		expect(prompts[0]).toContain("Allow bash?");
		expect(prompts[0]).toContain("Rule: Bash(npm test)");
	});

	it("a plain no aborts the turn", async () => {
		const { harness, executed } = await setup();
		await bindUi(harness, ["No"]);
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getAssistantTexts(harness)).not.toContain("done");
	});

	it("a no with feedback is returned to the model and the turn continues", async () => {
		const { harness, executed } = await setup();
		await bindUi(harness, ["No, and tell the model why"], "use pnpm");
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getMessageText(getToolResult(harness, "bash"))).toContain("use pnpm");
		expect(getAssistantTexts(harness)).toContain("done");
	});

	it("a session grant stops later prompts for the same command", async () => {
		const { harness, executed } = await setup();
		const prompts = await bindUi(harness, ["Yes, for this session"]);
		respond(harness, ["bash", { command: "npm test" }], ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["bash:npm test", "bash:npm test"]);
		expect(prompts).toHaveLength(1);
	});

	it("a project grant is written to .stela/permissions.local.json and gitignored", async () => {
		const { harness } = await setup();
		await bindUi(harness, ["Always in this project"]);
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		const dir = join(harness.tempDir, ".stela");
		expect(JSON.parse(readFileSync(join(dir, "permissions.local.json"), "utf8"))).toEqual({
			allow: ["Bash(npm test)"],
		});
		expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe("permissions.local.json\n");
	});

	it("accept edits from the dialog switches the mode", async () => {
		const { harness, executed } = await setup();
		await bindUi(harness, ["Yes, and accept edits for this session"]);
		respond(harness, ["write", { path: "a.txt", content: "x" }], ["write", { path: "b.txt", content: "y" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["write:a.txt", "write:b.txt"]);
		expect(harness.session.permissions?.mode).toBe("acceptEdits");
	});

	it("deny rules from settings block in every mode", async () => {
		const { harness, executed } = await setup({ settings: { permissions: { deny: ["Bash(npm:*)"] } } });
		harness.session.permissions?.setMode("acceptEdits");
		respond(harness, ["bash", { command: "npm test" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getMessageText(getToolResult(harness, "bash"))).toContain("Bash(npm:*) (user settings)");
	});

	it("plan mode denies writes with a reason", async () => {
		const { harness, executed } = await setup({ mode: "plan" });
		respond(harness, ["write", { path: "a.txt", content: "x" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getMessageText(getToolResult(harness, "write"))).toContain("Plan mode is read-only");
	});

	it("the gate checks arguments after an extension rewrites them", async () => {
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
			permissions: { analyzeShell: simpleShell },
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", async (event) => {
						(event.input as { command: string }).command = "rm -rf build";
						return undefined;
					});
				},
			],
		});
		harnesses.push(harness);
		respond(harness, ["bash", { command: "ls" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual([]);
		expect(getMessageText(getToolResult(harness, "bash"))).toContain("no one can approve");
	});

	it("without a permission controller every call runs, as before", async () => {
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
		});
		harnesses.push(harness);
		respond(harness, ["bash", { command: "rm -rf build" }]);
		await harness.session.prompt("go");
		expect(executed).toEqual(["rm -rf build"]);
		expect(existsSync(join(harness.tempDir, ".stela"))).toBe(false);
	});

	describe("exit_plan_mode", () => {
		function bindPlanUi(harness: Harness, answers: string[], input?: string) {
			const dialogs: Array<{ title: string; options: string[] }> = [];
			return harness.session
				.bindExtensions({
					uiContext: createTestUiContext({
						select: async (title, options) => {
							dialogs.push({ title, options });
							return answers.shift();
						},
						input: async () => input,
					}),
				})
				.then(() => dialogs);
		}

		it("is declared only while plan mode is active", async () => {
			const { harness } = await setup();
			const permissions = harness.session.permissions;
			expect(harness.session.getActiveToolNames()).not.toContain("exit_plan_mode");
			permissions?.setMode("plan");
			expect(harness.session.getActiveToolNames()).toContain("exit_plan_mode");
			expect(harness.session.systemPrompt).toContain("Plan mode is active");
			permissions?.setMode("manual");
			expect(harness.session.getActiveToolNames()).not.toContain("exit_plan_mode");
			expect(harness.session.systemPrompt).not.toContain("Plan mode is active");
		});

		it("approving switches to the chosen mode and the implementation runs", async () => {
			const { harness, executed } = await setup({ mode: "plan" });
			const dialogs = await bindPlanUi(harness, ["Implement in accept edits"]);
			respond(harness, ["exit_plan_mode", { plan: "1. write a.txt" }], ["write", { path: "a.txt", content: "x" }]);
			await harness.session.prompt("go");
			expect(dialogs).toHaveLength(1);
			expect(dialogs[0].options).toEqual(["Implement in accept edits", "Implement in manual", "Keep planning"]);
			expect(harness.session.permissions?.mode).toBe("acceptEdits");
			expect(getMessageText(getToolResult(harness, "exit_plan_mode"))).toContain("now accept edits");
			expect(executed).toEqual(["write:a.txt"]);
			expect(harness.session.getActiveToolNames()).not.toContain("exit_plan_mode");
		});

		it("offers auto when it is available", async () => {
			const { harness } = await setup({
				mode: "plan",
				settings: { permissions: { auto: { model: "faux/faux-1" } } },
			});
			const dialogs = await bindPlanUi(harness, ["Implement in auto"]);
			respond(harness, ["exit_plan_mode", { plan: "do it" }]);
			await harness.session.prompt("go");
			expect(dialogs[0].options).toContain("Implement in auto");
			expect(harness.session.permissions?.mode).toBe("auto");
		});

		it("keep planning with feedback stays in plan mode and continues the turn", async () => {
			const { harness } = await setup({ mode: "plan" });
			await bindPlanUi(harness, ["Keep planning"], "cover the tests");
			respond(harness, ["exit_plan_mode", { plan: "do it" }]);
			await harness.session.prompt("go");
			expect(harness.session.permissions?.mode).toBe("plan");
			expect(getMessageText(getToolResult(harness, "exit_plan_mode"))).toContain("cover the tests");
			expect(getAssistantTexts(harness)).toContain("done");
		});

		it("keep planning without feedback aborts the turn", async () => {
			const { harness } = await setup({ mode: "plan" });
			await bindPlanUi(harness, ["Keep planning"], "");
			respond(harness, ["exit_plan_mode", { plan: "do it" }]);
			await harness.session.prompt("go");
			expect(harness.session.permissions?.mode).toBe("plan");
			expect(getAssistantTexts(harness)).not.toContain("done");
		});

		it("stays in plan mode when no one can approve", async () => {
			const { harness } = await setup({ mode: "plan" });
			respond(harness, ["exit_plan_mode", { plan: "do it" }]);
			await harness.session.prompt("go");
			expect(harness.session.permissions?.mode).toBe("plan");
			expect(getMessageText(getToolResult(harness, "exit_plan_mode"))).toContain("No one can approve the plan");
		});

		it("plan mode may write the plan file, even in a protected directory", async () => {
			const executed: string[] = [];
			const write: AgentTool = {
				name: "write",
				label: "write",
				description: "Write a file",
				parameters: Type.Object({ path: Type.String(), content: Type.String() }),
				execute: async (_id, params) => {
					executed.push((params as { path: string }).path);
					return { content: [{ type: "text", text: "written" }], details: {} };
				},
			};
			const planDir = mkdtempSync(join(tmpdir(), "stela-plan-"));
			// `.stela` is a protected path component, like the agent directory where the CLI keeps plans.
			const planFilePath = join(planDir, ".stela", "plans", "session.md");
			const harness = await createHarness({ tools: [write], permissions: { initialMode: "plan", planFilePath } });
			harnesses.push(harness);
			try {
				respond(
					harness,
					["write", { path: planFilePath, content: "plan" }],
					["write", { path: "a.txt", content: "x" }],
				);
				await harness.session.prompt("go");
				expect(executed).toEqual([planFilePath]);
				expect(harness.session.systemPrompt).toContain(planFilePath);
			} finally {
				rmSync(planDir, { recursive: true, force: true });
			}
		});
	});
});
