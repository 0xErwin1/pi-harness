import j0k3rSubagentsExtension from "../j0k3r/index.ts";
import { registerPiHarnessCompat } from "../../../packages/subagents-compat/index.ts";

export default function piHarnessSubagentsExtension(pi: any): void {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const wrappedPi = {
		...pi,
		registerTool(tool: any) {
			if (tool?.name) tools.set(tool.name, tool);
			return pi.registerTool?.(tool);
		},
		registerCommand(name: string, command: any) {
			if (name) commands.set(name, command);
			return pi.registerCommand?.(name, command);
		},
	};

	j0k3rSubagentsExtension(wrappedPi);
	registerPiHarnessCompat(pi, { tools, commands });
}
