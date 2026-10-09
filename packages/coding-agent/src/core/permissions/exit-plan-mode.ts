import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { getMarkdownTheme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { getModeUnavailableReason, PERMISSION_MODE_LABELS, type PermissionMode } from "./modes.ts";
import type { PermissionController } from "./permission-controller.ts";

export const EXIT_PLAN_MODE_TOOL_NAME = "exit_plan_mode";

const exitPlanModeSchema = Type.Object({
	plan: Type.String({ description: "The implementation plan, in Markdown. The user reviews it before approving." }),
});

export type ExitPlanModeInput = Static<typeof exitPlanModeSchema>;

/** Modes the plan can be implemented in, in the order the dialog offers them. */
const IMPLEMENTATION_MODES: readonly PermissionMode[] = ["acceptEdits", "manual", "auto"];
const KEEP_PLANNING = "Keep planning";

export interface ExitPlanModeToolOptions {
	permissions: PermissionController;
	/** Stop the run and give control back to the user; called when the user keeps planning without feedback. */
	abortTurn: () => void;
}

/**
 * The model submits its plan; the user picks the mode to implement it in, or keeps planning with feedback.
 * AgentSession declares the tool only in plan mode.
 */
export function createExitPlanModeToolDefinition(
	options: ExitPlanModeToolOptions,
): ToolDefinition<typeof exitPlanModeSchema, undefined> {
	const { permissions } = options;
	const planFile = permissions.planFilePath;
	return {
		name: EXIT_PLAN_MODE_TOOL_NAME,
		label: "exit plan mode",
		description:
			"Present the implementation plan to the user and ask to leave plan mode. Call it only in plan mode, once the plan is complete. The user either approves it and picks how much autonomy the implementation gets, or keeps planning and tells you what to change.",
		promptSnippet: "Submit the plan for approval and leave plan mode",
		promptGuidelines: [
			"Plan mode is active: tool calls that change files or run non-read-only commands are denied. Investigate with read-only tools, then call exit_plan_mode with the complete plan.",
			...(planFile
				? [`In plan mode you may write a draft of the plan to ${planFile}; no other file can be written.`]
				: []),
		],
		parameters: exitPlanModeSchema,
		executionMode: "sequential",
		async execute(_toolCallId, { plan }, signal, _onUpdate, ctx) {
			if (permissions.mode !== "plan") throw new Error("Plan mode is not active.");
			if (plan.trim() === "") throw new Error("The plan is empty.");
			if (!ctx.hasUI) {
				throw new Error(
					"No one can approve the plan in this mode, so plan mode stays active. Present the plan as your answer.",
				);
			}

			const availability = permissions.getAvailability();
			const implement = new Map<string, PermissionMode>();
			for (const mode of IMPLEMENTATION_MODES) {
				if (getModeUnavailableReason(mode, availability) === undefined) {
					implement.set(`Implement in ${PERMISSION_MODE_LABELS[mode]}`, mode);
				}
			}
			const choice = await ctx.ui.select("Approve the plan?", [...implement.keys(), KEEP_PLANNING], { signal });
			const mode = choice === undefined ? undefined : implement.get(choice);
			if (mode) {
				permissions.setMode(mode);
				return {
					content: [
						{
							type: "text",
							text: `The user approved the plan. Plan mode is off; the permission mode is now ${PERMISSION_MODE_LABELS[mode]}. Implement the plan.`,
						},
					],
					details: undefined,
				};
			}

			const feedback =
				choice === KEEP_PLANNING ? (await ctx.ui.input("What should change?", "feedback", { signal }))?.trim() : "";
			if (!feedback) {
				// Like a plain "No" in the approval dialog: the user wants control back.
				options.abortTurn();
				throw new Error("The user kept plan mode active and stopped the run.");
			}
			return {
				content: [
					{
						type: "text",
						text: `The user did not approve the plan and plan mode stays active. Feedback: ${feedback}\nRevise the plan and call exit_plan_mode again.`,
					},
				],
				details: undefined,
			};
		},
		renderCall(args, theme, context) {
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("Plan")), 0, 0));
			if (args?.plan) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(args.plan, 0, 0, getMarkdownTheme()));
			} else if (context.isPartial) {
				container.addChild(new Text(theme.fg("muted", "writing plan..."), 0, 0));
			}
			return container;
		},
	};
}
