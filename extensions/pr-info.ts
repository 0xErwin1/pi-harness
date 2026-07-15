/**
 * PR-info producer.
 *
 * Runs a debounced `gh pr view` for the current branch and publishes the open
 * PR (number + url) on the `harness:pr` channel for the footer to link. When
 * `gh` is missing, unauthenticated, or there is no open PR, it publishes `null`
 * and the footer omits the segment — no error, stderr, or crash. This is a
 * non-visual extension: it registers no command or tool and owns no chrome.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { publish } from "../packages/events/index.ts";
import { createDebouncer } from "../packages/pr-info/debounce.ts";
import { lookupPr } from "../packages/pr-info/lookup.ts";

const PR_DEBOUNCE_MS = 1500;
const GH_TIMEOUT_MS = 10000;

export default function prInfo(pi: ExtensionAPI): void {
	let cwd = process.cwd();
	let disposed = false;

	const runLookup = (): void => {
		void lookupPr({
			cwd,
			exec: async (command, args) => {
				const result = await pi.exec(command, args, { cwd, timeout: GH_TIMEOUT_MS });
				return { code: result.code, stdout: result.stdout };
			},
		}).then((pr) => {
			if (!disposed) publish(pi, "harness:pr", pr);
		});
	};

	const debouncer = createDebouncer(PR_DEBOUNCE_MS, runLookup);

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		disposed = false;
		debouncer.schedule();
	});

	pi.on("turn_end", () => debouncer.schedule());

	pi.on("session_shutdown", () => {
		disposed = true;
		debouncer.dispose();
	});
}
