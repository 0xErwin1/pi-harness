import type { RunSnapshot, RunStatus } from "../../subagent-manager-core/events.ts";
import type {
	ManagerDoctorResult,
	ManagerDoctorCheck,
	ManagerInterruptResult,
	ManagerStatusResult,
} from "../commands.ts";

function summarizeStatus(status: RunStatus): string {
	switch (status) {
		case "needs-attention":
			return "needs attention";
		default:
			return status;
	}
}

function statusMode(snapshot: RunSnapshot): string {
	return snapshot.resolvedExecutionMode ?? snapshot.requestedExecutionMode;
}

export function renderStatusResult(result: ManagerStatusResult): string[] {
	if (!result.available) return [result.message];
	if (result.runs.length === 0) return [result.message];

	return [
		`${result.runs.length} manager run(s):`,
		...result.runs.map(
			(snapshot) =>
				`- ${snapshot.id} | ${snapshot.agent} | ${summarizeStatus(snapshot.status)} | mode=${statusMode(snapshot)}`,
		),
	];
}

export function renderInterruptResult(result: ManagerInterruptResult): string[] {
	return [result.message];
}

function renderDoctorCheck(check: ManagerDoctorCheck): string {
	const marker = check.ok ? "[ok]" : "[warn]";
	return `${marker} ${check.name}: ${check.detail}`;
}

export function renderDoctorResult(result: ManagerDoctorResult): string[] {
	return [
		`subagent manager runtime=${result.config.runtime}`,
		...result.checks.map(renderDoctorCheck),
	];
}
