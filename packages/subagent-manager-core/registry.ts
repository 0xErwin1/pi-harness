export type AgentScope = "builtin" | "user" | "project" | "ephemeral";
export type ExecutionMode = "in-process" | "subprocess" | "fork" | "auto";
export type EphemeralTemplate = "research" | "review" | "implement";
export type EphemeralAgentTtl = "run" | "session";

export interface AgentPolicyMetadata {
	visible: boolean;
	locked: boolean;
	template?: EphemeralTemplate;
	ttl?: EphemeralAgentTtl;
}

export interface AgentSpec {
	name: string;
	description: string;
	promptRef: string;
	policyMode: string;
	tools?: string[];
	model?: string;
	thinking?: string;
	execution?: ExecutionMode;
	inheritProjectContext?: boolean;
	inheritSkills?: boolean;
	policy?: AgentPolicyMetadata;
}

export interface EphemeralAgentSpec extends Omit<AgentSpec, "policyMode" | "policy"> {
	template: EphemeralTemplate;
	ttl: EphemeralAgentTtl;
}

export interface RegisteredAgent extends AgentSpec {
	scope: AgentScope;
	order: number;
}

export interface RegistryLayers {
	builtin?: AgentSpec[];
	user?: AgentSpec[];
	project?: AgentSpec[];
	ephemeral?: Array<AgentSpec | EphemeralAgentSpec>;
}

const SCOPE_ORDER: AgentScope[] = ["builtin", "user", "project", "ephemeral"];

const EPHEMERAL_TEMPLATE_POLICY: Record<EphemeralTemplate, Pick<AgentSpec, "policyMode" | "description">> = {
	research: {
		policyMode: "advisory",
		description: "Bounded read-only research helper.",
	},
	review: {
		policyMode: "reviewer",
		description: "Bounded review helper with no repository writes.",
	},
	implement: {
		policyMode: "writer",
		description: "Bounded implementation helper constrained by explicit policy.",
	},
};

function isEphemeralAgentSpec(agent: AgentSpec | EphemeralAgentSpec): agent is EphemeralAgentSpec {
	return "template" in agent && "ttl" in agent;
}

function normalizeScopedAgent(scope: AgentScope, agent: AgentSpec | EphemeralAgentSpec): AgentSpec {
	if (scope !== "ephemeral" || !isEphemeralAgentSpec(agent)) return agent as AgentSpec;

	const templateDefaults = EPHEMERAL_TEMPLATE_POLICY[agent.template];
	return {
		...agent,
		description: agent.description || templateDefaults.description,
		policyMode: templateDefaults.policyMode,
		policy: {
			visible: true,
			locked: true,
			template: agent.template,
			ttl: agent.ttl,
		},
	};
}

export function mergeRegistryLayers(layers: RegistryLayers): RegisteredAgent[] {
	const scopedEntries = SCOPE_ORDER.flatMap((scope) =>
		(layers[scope] ?? []).map((agent, index) => ({
			scope,
			index,
			agent: normalizeScopedAgent(scope, agent),
		})),
	);
	const merged = new Map<string, RegisteredAgent>();

	for (const entry of scopedEntries) {
		merged.set(entry.agent.name, {
			...entry.agent,
			scope: entry.scope,
			order: entry.index,
		});
	}

	return [...merged.values()].sort((left, right) => {
		const scopeDelta = SCOPE_ORDER.indexOf(right.scope) - SCOPE_ORDER.indexOf(left.scope);
		if (scopeDelta !== 0) return scopeDelta;
		return left.order - right.order;
	});
}

export function listAgentsByScope(layers: RegistryLayers, scope: AgentScope | "all" = "all"): RegisteredAgent[] {
	const merged = mergeRegistryLayers(layers);
	if (scope === "all") return merged;
	return merged.filter((agent) => agent.scope === scope);
}

export function resolveAgent(layers: RegistryLayers, name: string): RegisteredAgent | undefined {
	return mergeRegistryLayers(layers).find((agent) => agent.name === name);
}
