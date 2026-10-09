import { resolvePermissionPath } from "./paths.ts";

/**
 * How the gate treats a tool call.
 * - `readOnly`: built-in read/grep/find/ls; runs inside the workspace.
 * - `edit`: built-in edit/write.
 * - `shell`: bash/powershell; analyzed per segment.
 * - `fetch`: a web fetch tool with a URL; matched by domain.
 * - `other`: MCP, extension, and unknown tools. They ask unless a rule allows them; a self-declared
 *   read-only hint is never trusted for allow.
 */
export type ClassifiedCall =
	| { kind: "readOnly"; tool: string; paths: string[] }
	| { kind: "edit"; tool: string; paths: string[] }
	| { kind: "shell"; tool: string; command: string }
	| { kind: "fetch"; tool: string; host: string }
	| { kind: "other"; tool: string };

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
/** Tools with their own user dialog; the gate does not ask again. */
const SELF_APPROVING_TOOLS = new Set(["exit_plan_mode"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const FETCH_TOOL = /^web_?fetch$/i;

export function classifyToolCall(tool: string, args: unknown, cwd: string): ClassifiedCall {
	const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	if (SELF_APPROVING_TOOLS.has(tool)) return { kind: "readOnly", tool, paths: [] };
	if (READ_ONLY_TOOLS.has(tool)) {
		const path = typeof input.path === "string" && input.path !== "" ? input.path : ".";
		return { kind: "readOnly", tool, paths: [resolvePermissionPath(path, cwd)] };
	}
	if (EDIT_TOOLS.has(tool) && typeof input.path === "string") {
		return { kind: "edit", tool, paths: [resolvePermissionPath(input.path, cwd)] };
	}
	if (SHELL_TOOLS.has(tool) && typeof input.command === "string") {
		return { kind: "shell", tool, command: input.command };
	}
	if (FETCH_TOOL.test(tool) && typeof input.url === "string") {
		const host = parseHost(input.url);
		if (host !== undefined) return { kind: "fetch", tool, host };
	}
	return { kind: "other", tool };
}

function parseHost(url: string): string | undefined {
	try {
		return new URL(url).hostname || undefined;
	} catch {
		return undefined;
	}
}
