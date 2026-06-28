import type { IconMode, IconSet } from "./types.ts";

/**
 * Central icon catalog keyed by display mode.
 *
 * Nerd Font codepoints use nf-fa (FontAwesome) glyphs from the Private Use Area.
 * No Unicode variation selectors (U+FE0F) are appended — these are text-mode glyphs only.
 * This is a tunable starting set; adjust via PI_HARNESS_ICONS or settings.json.
 */
export const ICON_CATALOG: Record<IconMode, IconSet> = {
	nerdfont: {
		taskPending: "",	// nf-fa-square_o U+F096
		taskInProgress: "",	// nf-fa-dot_circle_o U+F192
		taskCompleted: "",	// nf-fa-check U+F00C
		taskDeleted: "",	// nf-fa-times U+F00D
		headerActive: "",	// nf-fa-circle U+F111
		headerIdle: "",	// nf-fa-circle_o U+F10C
		chevron: "",	// nf-fa-chevron_right U+F054
		arrowUp: "",	// nf-fa-arrow_up U+F062
		arrowDown: "",	// nf-fa-arrow_down U+F063
		ellipsis: "",	// nf-fa-ellipsis_h U+F141
		agentDone: "",	// nf-fa-check_circle U+F058
		agentFailed: "",	// nf-fa-times_circle U+F057
		agentInterrupted: "",	// nf-fa-stop U+F04D
		agentStale: "",	// nf-fa-clock_o U+F017
		selection: "",	// nf-fa-caret_right U+F0DA
		treeBranch: "├─",
		treeLast: "└─",
		treeVertical: "│",
		treeSub: "└",
		branch: "",	// nf-pl-branch U+E0A0
		barFull: "█",	// full block U+2588
		barEmpty: "░",	// light shade U+2591
		spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	},

	unicode: {
		taskPending: "◻",
		taskInProgress: "◼",
		taskCompleted: "✔",
		taskDeleted: "✗",
		headerActive: "●",
		headerIdle: "○",
		chevron: "›",
		arrowUp: "↑",
		arrowDown: "↓",
		ellipsis: "…",
		agentDone: "done",
		agentFailed: "failed",
		agentInterrupted: "interrupted",
		agentStale: "stale",
		selection: ">",
		treeBranch: "├─",
		treeLast: "└─",
		treeVertical: "│",
		treeSub: "└",
		branch: "⎇",	// U+2387 alternative key symbol
		barFull: "█",	// full block U+2588
		barEmpty: "░",	// light shade U+2591
		spinner: ["✳", "✴", "✵", "✶", "✷", "✸", "✹", "✺", "✻", "✼", "✽"],
	},

	ascii: {
		taskPending: "[ ]",
		taskInProgress: ">",
		taskCompleted: "[x]",
		taskDeleted: "x",
		headerActive: "*",
		headerIdle: "o",
		chevron: ">",
		arrowUp: "^",
		arrowDown: "v",
		ellipsis: "...",
		agentDone: "done",
		agentFailed: "failed",
		agentInterrupted: "interrupted",
		agentStale: "stale",
		selection: ">",
		treeBranch: "+-",
		treeLast: "`-",
		treeVertical: "|",
		treeSub: "`",
		branch: "br",
		barFull: "#",
		barEmpty: "-",
		spinner: ["-", "\\", "|", "/"],
	},
};
