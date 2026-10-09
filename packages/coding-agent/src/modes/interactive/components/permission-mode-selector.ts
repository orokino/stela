import {
	Container,
	type Focusable,
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";
import {
	getModeUnavailableReason,
	PERMISSION_MODE_DESCRIPTIONS,
	PERMISSION_MODE_LABELS,
	PERMISSION_MODES,
	type PermissionMode,
	type PermissionModeAvailability,
} from "../../../core/permissions/modes.ts";
import { getSelectListTheme, theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyDisplayText } from "./keybinding-hints.ts";

const PERMISSION_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
	minPrimaryColumnWidth: 20,
	maxPrimaryColumnWidth: 24,
};

/** `/permissions` picker: all five modes with a one-line description; unavailable modes say why. */
export class PermissionModeSelectorComponent extends Container implements Focusable {
	private selectList: SelectList;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
	}

	constructor(
		currentMode: PermissionMode,
		availability: PermissionModeAvailability,
		onSelect: (mode: PermissionMode) => void,
		onCancel: () => void,
	) {
		super();
		const items: SelectItem[] = PERMISSION_MODES.map((mode) => {
			const unavailable = getModeUnavailableReason(mode, availability);
			return {
				value: mode,
				label: `${mode === currentMode ? "✓ " : "  "}${PERMISSION_MODE_LABELS[mode]}`,
				description: unavailable
					? theme.fg("dim", `unavailable: ${unavailable}`)
					: PERMISSION_MODE_DESCRIPTIONS[mode],
			};
		});

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text("Permission Mode", 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${keyDisplayText("app.permissions.cycle")} cycles permission modes in-session`, 0, 0));
		this.addChild(new Spacer(1));

		this.selectList = new SelectList(items, items.length, getSelectListTheme(), PERMISSION_SELECT_LIST_LAYOUT);
		this.selectList.setSelectedIndex(PERMISSION_MODES.indexOf(currentMode));
		this.selectList.onSelect = (item) => onSelect(item.value as PermissionMode);
		this.selectList.onCancel = onCancel;
		this.addChild(this.selectList);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				theme.fg(
					"dim",
					`  ${keyDisplayText("tui.select.confirm")} to select · ${keyDisplayText("tui.select.cancel")} to cancel`,
				),
				0,
				0,
			),
		);
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		this.selectList.handleInput(keyData);
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
