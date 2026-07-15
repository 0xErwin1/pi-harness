/**
 * The placeholder -> lazy-file map consumed by `render.ts`.
 *
 * Each key is the exact `{{KEY}}` token expected inside `assets/orchestrator.md`
 * (the core prompt); each value is the file's path relative to the assets
 * directory. Adding a relocated section later only needs a new entry here plus
 * the file itself under `assets/orchestrator/` — `render.ts` needs no changes.
 */
export const LAZY_FILES = {
	PI_HARNESS_SDD_WORKFLOW_PATH: "orchestrator/sdd-workflow.md",
	PI_HARNESS_SDD_TESTING_PATH: "orchestrator/sdd-testing.md",
	PI_HARNESS_SUBAGENT_RUNTIME_PATH: "orchestrator/subagent-runtime.md",
	PI_HARNESS_PERSISTENCE_PATH: "orchestrator/persistence.md",
	PI_HARNESS_SKILLS_PATH: "orchestrator/skills.md",
	PI_HARNESS_REVIEW_PATH: "orchestrator/review.md",
	PI_HARNESS_LANGUAGE_CODEGRAPH_PATH: "orchestrator/language-codegraph.md",
} as const;

export type LazyFileKey = keyof typeof LAZY_FILES;
