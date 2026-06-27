import type { RegisteredAgent } from "./registry";

export type PolicyMode = "advisory" | "writer" | "reviewer" | "fanout" | "custom";
export type RunStrategy = "single" | "parallel" | "chain";

export interface PolicyCheckInput {
	agent: RegisteredAgent;
	policyMode?: PolicyMode;
	requiresWrite?: boolean;
	strategy?: RunStrategy;
}

export interface PolicyDecision {
	allowed: boolean;
	effectiveMode: PolicyMode;
	reason?: string;
}

function normalizePolicyMode(mode: string | undefined): PolicyMode {
	if (
		mode === "advisory" ||
		mode === "writer" ||
		mode === "reviewer" ||
		mode === "fanout" ||
		mode === "custom"
	) {
		return mode;
	}
	return "custom";
}

function hasLockedPolicy(agent: RegisteredAgent): boolean {
	return agent.policy?.visible === true && agent.policy?.locked === true;
}

export function evaluatePolicy(input: PolicyCheckInput): PolicyDecision {
	const defaultMode = normalizePolicyMode(input.agent.policyMode);
	const effectiveMode = normalizePolicyMode(input.policyMode ?? input.agent.policyMode);
	const strategy = input.strategy ?? "single";

	if (hasLockedPolicy(input.agent) && input.policyMode !== undefined && effectiveMode !== defaultMode) {
		return {
			allowed: false,
			effectiveMode: defaultMode,
			reason: `agent '${input.agent.name}' is locked to ${defaultMode} policy via the ${input.agent.policy?.template ?? input.agent.scope} template`,
		};
	}

	if (input.requiresWrite && (effectiveMode === "advisory" || effectiveMode === "reviewer")) {
		return {
			allowed: false,
			effectiveMode,
			reason: `${effectiveMode} mode cannot modify the repository`,
		};
	}

	if (strategy !== "parallel" && effectiveMode === "fanout") {
		return {
			allowed: false,
			effectiveMode,
			reason: "fanout mode requires a parallel dispatch strategy",
		};
	}

	return { allowed: true, effectiveMode };
}
