import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getModel,
	type ToolCall,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ShellAnalyzer } from "../src/core/permissions/gate.ts";
import { PermissionController } from "../src/core/permissions/permission-controller.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

const simpleShell: ShellAnalyzer = (command) => ({
	kind: "parsed",
	segments: [{ command: command.trim(), readOnly: false, writes: [], reads: [] }],
});

function assistantMessage(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]) {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	} satisfies AssistantMessage;
}

function records(): Array<Record<string, unknown>> {
	return rpcIo.outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("RPC permission approval", () => {
	const cleanups: Array<() => Promise<void>> = [];
	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	async function start() {
		const tempDir = join(tmpdir(), `stela-rpc-permissions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		const model = getModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Test model not found");

		const toolCall: ToolCall = { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "npm test" } };
		const responses = [
			assistantMessage([toolCall], "toolUse"),
			assistantMessage([{ type: "text", text: "done" }], "stop"),
		];
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, _context, options) => {
				const stream = createAssistantMessageEventStream();
				// Like real providers, an aborted run ends the stream as aborted.
				if (options?.signal?.aborted) {
					const aborted = assistantMessage([], "aborted");
					queueMicrotask(() => stream.push({ type: "error", reason: "aborted", error: aborted }));
					return stream;
				}
				const message = responses.shift() ?? assistantMessage([{ type: "text", text: "exhausted" }], "stop");
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
				});
				return stream;
			},
		});

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
		const settingsManager = SettingsManager.inMemory();
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(await createInMemoryModelRegistry(authStorage)),
			resourceLoader: createTestResourceLoader(),
			baseToolsOverride: { bash },
			permissionController: new PermissionController({
				cwd: tempDir,
				agentDir: join(tempDir, "agent"),
				settingsManager,
				analyzeShell: simpleShell,
			}),
		});
		const runtimeHost = {
			session,
			newSession: vi.fn(async () => ({ cancelled: true })),
			switchSession: vi.fn(async () => ({ cancelled: true })),
			fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
			dispose: vi.fn(async () => {}),
			setRebindSession: vi.fn(),
		} as unknown as AgentSessionRuntime;
		cleanups.push(async () => {
			await session.abort().catch(() => {});
			session.dispose();
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		});

		void runRpcMode(runtimeHost);
		await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
		return { send: (value: unknown) => rpcIo.lineHandler?.(JSON.stringify(value)), executed, session };
	}

	async function nextApproval() {
		let request: Record<string, unknown> | undefined;
		await vi.waitFor(() => {
			request = records().find((record) => record.type === "extension_ui_request" && record.method === "select");
			expect(request).toBeDefined();
		});
		return request as { id: string; title: string; options: string[] };
	}

	it("asks the client with extension_ui_request and runs the call on Yes", async () => {
		const { send, executed, session } = await start();
		send({ id: "p1", type: "prompt", message: "go" });
		const request = await nextApproval();
		expect(request.title).toContain("Allow bash?");
		expect(request.options).toContain("Yes, for this session");
		send({ type: "extension_ui_response", id: request.id, value: "Yes" });
		await vi.waitFor(() => expect(executed).toEqual(["npm test"]));
		await session.agent.waitForIdle();
	});

	it("a cancelled request denies the call and stops the turn", async () => {
		const { send, executed, session } = await start();
		send({ id: "p1", type: "prompt", message: "go" });
		const request = await nextApproval();
		send({ type: "extension_ui_response", id: request.id, cancelled: true });
		await vi.waitFor(() =>
			expect(records().some((record) => record.type === "tool_execution_end" && record.isError === true)).toBe(true),
		);
		await session.agent.waitForIdle();
		expect(executed).toEqual([]);
		const texts = session.messages.flatMap((message) =>
			message.role === "assistant"
				? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
				: [],
		);
		expect(texts).not.toContain("done");
	});
});
