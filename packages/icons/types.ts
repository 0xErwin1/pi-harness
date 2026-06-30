export type IconMode = "nerdfont" | "unicode" | "ascii";

export interface IconSet {
	taskPending: string;
	taskInProgress: string;
	taskCompleted: string;
	taskDeleted: string;
	headerActive: string;
	headerIdle: string;
	chevron: string;
	arrowUp: string;
	arrowDown: string;
	ellipsis: string;
	agentDone: string;
	agentFailed: string;
	agentInterrupted: string;
	agentStale: string;
	selection: string;
	treeBranch: string;
	treeLast: string;
	treeVertical: string;
	treeSub: string;
	branch: string;
	barFull: string;
	barEmpty: string;
	spinner: string[];
}
