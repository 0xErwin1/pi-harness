import type { ExecutionProvider } from "../runtime.ts";
import { runPiProcessProvider } from "./process-runner.ts";

export function createSubprocessProvider(): ExecutionProvider {
	return {
		kind: "subprocess",
		canHandle: () => true,
		run: (context) => runPiProcessProvider(context),
	};
}
