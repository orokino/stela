import {
	type Component,
	getKeybindings,
	pickSymbol,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

export interface ShortcutGroup {
	title: string;
	items: Array<{ label: string; keys: string[] }>;
	collapsed: boolean;
}

/**
 * GK cheatsheet overlay (S13): Essentials open, other groups collapsed, `/`
 * filters, all key text composed live from the binding table. `?` stays text:
 * the overlay opens on Ctrl+X / Ctrl+. only.
 */
export class ShortcutsOverlayComponent implements Component {
	declare focused: boolean;
	private filter = "";
	private expanded = new Set<string>();
	private selectedIndex = 0;
	onClose?: () => void;

	groupTitles(): string[] {
		return shortcutGroups().map((g) => g.title);
	}

	isExpanded(title: string): boolean {
		if (title === "Essentials") return true;
		return this.expanded.has(title);
	}

	invalidate(): void {}

	visibleRows(): Array<{ kind: "group" | "item"; title: string; label?: string; keys?: string[] }> {
		const query = this.filter.replace(/^\//, "").toLowerCase();
		const rows: Array<{ kind: "group" | "item"; title: string; label?: string; keys?: string[] }> = [];
		for (const group of shortcutGroups()) {
			const items = group.items.filter(
				(item) =>
					query === "" ||
					item.label.toLowerCase().includes(query) ||
					item.keys.join(" ").toLowerCase().includes(query),
			);
			if (query !== "" && items.length === 0) continue;
			rows.push({ kind: "group", title: group.title });
			if (this.isExpanded(group.title) || query !== "") {
				for (const item of items)
					rows.push({ kind: "item", title: group.title, label: item.label, keys: item.keys });
			}
		}
		return rows;
	}

	render(width: number): string[] {
		const inner = Math.max(20, width - 4);
		const border = (text: string): string => theme.fg("dim", text);
		const lines: string[] = [];
		const titleKey = keyText("app.shortcuts.toggle");
		const title = `Keyboard Shortcuts${titleKey ? ` (${titleKey})` : ""}`;
		lines.push(border(`+- ${title} ${"-".repeat(Math.max(0, inner - title.length - 4))} [x] -+`));
		lines.push(`|  /${this.filter.replace(/^\//, "")}${" ".repeat(Math.max(0, inner - this.filter.length - 4))}|`);
		lines.push(border(`|${"-".repeat(inner)}|`));
		const rows = this.visibleRows();
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, Math.max(0, rows.length - 1)));
		const maxRows = 14;
		const start = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(maxRows / 2), Math.max(0, rows.length - maxRows)),
		);
		for (const row of rows.slice(start, start + maxRows)) {
			if (row.kind === "group") {
				const marker = this.isExpanded(row.title) ? pickSymbol("❯", ">") : pickSymbol("›", ">");
				const count = shortcutGroups().find((g) => g.title === row.title)?.items.length ?? 0;
				const label = row.title === "Essentials" ? `${marker} ${row.title}` : `${marker} ${row.title} (${count})`;
				lines.push(
					`|  ${truncateToWidth(label, inner - 4, "")}${" ".repeat(Math.max(0, inner - 4 - visibleWidth(label)))}|`,
				);
			} else {
				const keys = (row.keys ?? []).join(" / ");
				const label = row.label ?? "";
				const gap = Math.max(2, inner - 4 - visibleWidth(label) - visibleWidth(keys));
				lines.push(
					`|    ${label}${" ".repeat(gap)}${keys}${" ".repeat(Math.max(0, inner - 4 - visibleWidth(label) - gap - visibleWidth(keys)))}|`,
				);
			}
		}
		const up = pickSymbol("↑", "^");
		const down = pickSymbol("↓", "v");
		const hint = `${up}/${down} nav | f filter | e expand | Esc close`;
		lines.push(
			`|  ${theme.fg("dim", truncateToWidth(hint, inner - 4, ""))}${" ".repeat(Math.max(0, inner - 4 - visibleWidth(hint)))}|`,
		);
		lines.push(border(`+${"-".repeat(inner)}+`));
		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel") || kb.matches(data, "app.shortcuts.toggle")) {
			this.onClose?.();
			return;
		}
		if (kb.matches(data, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			this.selectedIndex = Math.min(Math.max(0, this.visibleRows().length - 1), this.selectedIndex + 1);
			return;
		}
		const printable = data.length === 1 ? data : undefined;
		if (printable === "e" || printable === "E") {
			const row = this.visibleRows()[this.selectedIndex];
			const title = row?.title;
			if (title && title !== "Essentials") {
				if (this.expanded.has(title)) this.expanded.delete(title);
				else this.expanded.add(title);
			}
			return;
		}
		if (printable === "f" || printable === "F") {
			if (!this.filter.startsWith("/")) this.filter = "/";
			return;
		}
		if (printable !== undefined && (this.filter.startsWith("/") || printable === "/")) {
			if (printable === "/") this.filter = "/";
			else this.filter += printable;
			this.selectedIndex = 0;
			return;
		}
		if (data === "\x7f" || data === "\b") {
			this.filter = this.filter.slice(0, -1);
			this.selectedIndex = 0;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			const delta = event.wheelDelta < 0 ? -1 : 1;
			this.selectedIndex = Math.max(
				0,
				Math.min(Math.max(0, this.visibleRows().length - 1), this.selectedIndex + delta),
			);
			return { handled: true };
		}
		return undefined;
	}
}

function shortcutGroups(): ShortcutGroup[] {
	const keys = (id: Parameters<typeof keyText>[0]): string[] => {
		const text = keyText(id);
		return text === "" ? [] : [text];
	};
	return [
		{
			title: "Essentials",
			collapsed: false,
			items: [
				{ label: "Send", keys: keys("tui.input.submit") },
				{ label: "Cycle permission mode", keys: keys("app.permissions.cycle") },
				{ label: "Command palette", keys: keys("app.model.cycleForward") },
				{ label: "Keyboard shortcuts", keys: keys("app.shortcuts.toggle") },
			],
		},
		{
			title: "Input",
			collapsed: true,
			items: [
				{ label: "Newline", keys: keys("tui.input.newLine") },
				{ label: "Queue follow-up", keys: keys("app.message.followUp") },
				{ label: "Restore queued", keys: keys("app.message.dequeue") },
				{ label: "Re-expand paste", keys: keys("app.editor.pasteExpand") },
				{ label: "Copy message", keys: keys("app.message.copy") },
				{ label: "History search", keys: keys("tui.editor.historySearch") },
				{ label: "External editor", keys: keys("app.editor.external") },
				{ label: "Clear editor", keys: keys("app.clear") },
				{ label: "Interrupt", keys: keys("app.interrupt") },
			],
		},
		{
			title: "Session",
			collapsed: true,
			items: [
				{ label: "Model selector", keys: keys("app.model.select") },
				{ label: "Thinking level", keys: keys("app.thinking.cycle") },
				{ label: "Expand tool output", keys: keys("app.tools.expand") },
				{ label: "Toggle thinking", keys: keys("app.thinking.toggle") },
			],
		},
	];
}
