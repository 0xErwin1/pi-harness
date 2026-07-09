import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function preferDetailedReasoningSummary(payload: unknown): unknown | undefined {
	if (!isRecord(payload)) return undefined;
	if (!isRecord(payload.reasoning)) return undefined;
	if (payload.reasoning.summary !== "auto") return undefined;
	if (!isStringArray(payload.include) || !payload.include.includes("reasoning.encrypted_content")) return undefined;

	return {
		...payload,
		reasoning: {
			...payload.reasoning,
			summary: "detailed",
		},
	};
}

export default function reasoningSummary(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => preferDetailedReasoningSummary(event.payload));
}
