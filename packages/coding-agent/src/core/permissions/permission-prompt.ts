import type { ExtensionUIContext } from "../extensions/types.ts";
import type { PermissionPrompter } from "./permission-controller.ts";

const YES = "Yes";
const YES_SESSION = "Yes, for this session";
const ALWAYS_PROJECT = "Always in this project";
const ACCEPT_EDITS = "Yes, and accept edits for this session";
const NO_FEEDBACK = "No, and tell the model why";
const NO = "No";

/**
 * Approval dialog on top of the extension UI `select`/`input`, so it works in the TUI and over RPC
 * (`extension_ui_request`) without new protocol.
 */
export function createUIPermissionPrompter(ui: Pick<ExtensionUIContext, "select" | "input">): PermissionPrompter {
	return async (prompt, signal) => {
		const lines = [`Allow ${prompt.toolName}?`, prompt.summary, prompt.reason];
		if (prompt.suggestedRules.length > 0) lines.push(`Rule: ${prompt.suggestedRules.join(", ")}`);
		const options = [YES];
		if (prompt.suggestedRules.length > 0) options.push(YES_SESSION);
		if (prompt.canSaveToProject) options.push(ALWAYS_PROJECT);
		if (prompt.canAcceptEdits) options.push(ACCEPT_EDITS);
		options.push(NO_FEEDBACK, NO);

		const choice = await ui.select(lines.join("\n"), options, { signal, kind: "permission" });
		switch (choice) {
			case YES:
				return { kind: "once" };
			case YES_SESSION:
				return { kind: "session" };
			case ALWAYS_PROJECT:
				return { kind: "project" };
			case ACCEPT_EDITS:
				return { kind: "acceptEdits" };
			case NO_FEEDBACK: {
				const feedback = (
					await ui.input("Tell the model why", "what to do instead", { signal, kind: "permission" })
				)?.trim();
				return { kind: "deny", feedback: feedback || undefined };
			}
			case NO:
				return { kind: "deny" };
			default:
				return undefined;
		}
	};
}
