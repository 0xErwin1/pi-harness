# Atlas Persistence Contract

Atlas is a first-class persistence backend for user-facing knowledge and work management. Use it when the user asks to create, read, update, organize, or track durable workspace records in Atlas.

For new SDD flows, Atlas is the default human-facing detailed artifact workspace. Engram remains the agent memory/pointer store. Obsidian is an explicit legacy/fallback backend only when selected by the user or active phase contract.

## Contract Scope

This contract describes how agents should use an already configured Atlas instance. It must stay project-agnostic:

- Do not assume a local Atlas source checkout or repository path.
- Do not assume workspace, project, folder, board, column, document, or task identifiers.
- Do not assume the current coding repository maps to an Atlas workspace/project.
- Discover all runtime targets through Atlas MCP before reading or mutating.

Atlas behavior this contract relies on:

- Atlas exposes markdown knowledge, kanban tasks, projects, workspaces, search, and metadata through one shared backend.
- Atlas MCP is the required agent interface for all Atlas operations.
- Atlas document content writes are revision-based compare-and-swap operations.
- Atlas task and document update tools use PATCH semantics.
- Atlas destructive operations require explicit confirmation semantics.

## Backend Role

Atlas persists collaborative workspace objects:

- Workspaces: tenant/collaboration boundary.
- Projects: grouping for notes, folders, boards, and project-scoped sharing.
- Folders: document organization inside a project.
- Documents: markdown notes with revisions, frontmatter, wikilinks, backlinks, and attachments.
- Boards and columns: kanban planning surfaces.
- Tasks: work items with readable IDs, labels, priorities, assignees, references, checklists, subtasks, attachments, and activity.
- Tags, saved searches, task views, members, audit feeds, and other workspace metadata.

Use Atlas when the user wants information to be visible and durable in an Atlas workspace: notes, decisions meant for humans, project plans, task boards, task references, backlog items, status updates, or workspace knowledge.

## MCP Surface

Prefer the `atlas` MCP server whenever its tools are available. It exposes tools and resources; it does not expose prompts.

### Resources

Atlas advertises document resources with this URI template:

```text
atlas:///{workspace}/{slug}
```

- `workspace` is a workspace slug.
- `slug` is a document slug or UUID.
- Resource reads return document bodies as `text/markdown`.
- Use resource reads for direct document body retrieval when the URI is already known; otherwise discover documents with tools first.

### Authentication and attribution

- Stdio MCP mode uses a startup bearer token from the Atlas MCP host configuration.
- HTTP MCP mode requires `Authorization: Bearer atlas_<token>` per request.
- Prefer API-key credentials for agent workflows so Atlas can attribute actions to an agent principal instead of a human user.
- Never print, log, echo, or persist Atlas tokens, API keys, session tokens, root passwords, webhook secrets, or activation links.

### General tool conventions

- Discover before mutating.
- List calls return paginated envelopes such as `{items, next_cursor, has_more}`; continue with the returned cursor when a complete result set is needed.
- Heavy reads are compact by default; request full detail whenever task context will be used for planning, implementation, status reporting, editing, verification, or quoting exact content.
- When retrieving tasks for user-facing work, do not rely on list/search titles alone. After identifying relevant task IDs, call `atlas_get_task` with `detail: "full"`, then call the relationship/detail tools needed to gather the useful context: body/description, task fields, board/column/status, priority, assignees, labels, estimates, due dates, custom properties, checklists, subtasks, references, backlinks, linked documents, task attachments metadata, activity, related files, and external links.
- PATCH tools distinguish omitted fields from explicit `null`: omitted means leave unchanged; `null` means clear where supported.
- Destructive tools require explicit user confirmation and `confirm: true` where supported.
- Some write tools resolve boards/columns by name and may return actionable ambiguity or valid-option errors; do not guess after ambiguity.

## Normal SDD Phase Document Allowlist

Directly persisting SDD phase agents receive only this document-persistence surface. Human Atlas task tracking and every task, board, admin, attachment, move, copy, or delete operation remain parent-owned.

Discovery and read:

- `atlas_search`
- `atlas_list_workspaces`
- `atlas_list_projects`
- `atlas_list_folders`
- `atlas_list_documents`
- `atlas_get_document`

Approved creation and content update:

- `atlas_create_folder`
- `atlas_create_document`
- `atlas_update_document_content`

For an existing document, call `atlas_get_document`, capture the returned `head_revision_id`, and call `atlas_update_document_content` with `base_revision_id=<head_revision_id>`. Create a folder or document only after the discovery tools confirm that the target is absent.

On any conflict, unavailable Atlas backend or tool, or unapproved write, return `partial` or `blocked`; never overwrite stale content, retry from a stale revision, or claim Atlas success. Save an Engram Atlas pointer only after successful Atlas creation or update. An allowed Engram full-content fallback is not an Atlas pointer and must retain degraded status.

## MCP Tool Capabilities

The capabilities below describe the broader parent-owned Atlas surface. They do not expand a normal SDD phase agent's allowlist.

### Discovery and reads

Use these before writes and for normal browsing. For tasks, list/search results are discovery only unless the user explicitly asks for a lightweight list. When the user asks to fetch, inspect, summarize, plan from, or work on tasks, hydrate each relevant task with full details and useful relationships before reasoning from it.

- `atlas_ping` — confirm the MCP server is reachable.
- `atlas_search` — search documents and tasks across a workspace.
- `atlas_list_workspaces` — discover accessible workspaces.
- `atlas_list_projects` — discover projects in a workspace.
- `atlas_list_documents`, `atlas_get_document` — browse and retrieve documents.
- `atlas_list_folders` — inspect document organization.
- `atlas_list_boards`, `atlas_list_columns` — discover task board structure before creating or moving tasks.
- `atlas_list_tasks`, `atlas_get_task` — browse and retrieve tasks by readable ID. Treat `atlas_list_tasks` as a task locator; call `atlas_get_task` with `detail: "full"` for each relevant task before using its content.
- `atlas_list_tags`, `atlas_list_used_labels` — inspect tag/label vocabulary.
- `atlas_list_members` — discover user and API-key principals for assignments.
- `atlas_list_saved_searches`, `atlas_list_task_views` — discover saved workspace views.
- `atlas_get_task_references`, `atlas_get_task_backlinks`, `atlas_get_document_backlinks` — inspect relationships; use these when task context may depend on linked work, documents, files, or external references.
- `atlas_list_checklist`, `atlas_list_activity`, `atlas_list_workspace_activity` — inspect task/workspace history and state; use task checklist/activity reads when details may affect implementation or status.
- `atlas_list_document_history`, `atlas_get_document_revision` — inspect document revision history and exact historical content.
- `atlas_list_attachments` — inspect document/workspace attachment metadata where available.
- `atlas_list_task_attachments` — inspect task attachment metadata. Parameters: `workspace`, `readable_id`. Returns metadata such as `id`, `file_name`, `content_type`, `size_bytes`, `actor`, and `created_at`; include these details in task context when useful.
- `atlas_get_workspace_audit`, `atlas_get_platform_audit` — inspect audit data when the user asks and permissions allow.

### Document and folder writes

The parent may use broader document-management tools when the user explicitly requests those operations. Normal SDD phase agents remain limited to the allowlist above.

Document content write protocol:

1. Discover the workspace, project, folder, and document without guessing identifiers.
2. Create the target only after search and list calls confirm that it does not already exist.
3. Before a content update, call `atlas_get_document` with full detail and capture its `head_revision_id`.
4. Call `atlas_update_document_content` with `base_revision_id=<head_revision_id>`.
5. On a conflict, unavailable tool/backend, or unapproved write, return `partial` or `blocked`; never overwrite current content or retry from stale context.
6. Save an Engram Atlas pointer only after a successful Atlas write.

### Task and planning writes

These tools are parent-owned for SDD. Use them only when the user explicitly requests human Atlas task tracking and the active contract approves mutation:

- `atlas_create_task` — create a task on a board/column.
- `atlas_update_task` — patch task fields such as title, description, priority, estimate, due date, labels, or custom properties.
- `atlas_move_task` — move a task between columns/statuses.
- `atlas_delete_task` — delete a task only after explicit confirmation.
- `atlas_add_task_assignee`, `atlas_remove_task_assignee` — manage assignment.
- `atlas_add_task_reference`, `atlas_remove_task_reference` — link tasks/documents or related work.
- `atlas_add_checklist_item`, `atlas_update_checklist_item`, `atlas_delete_checklist_item`, `atlas_promote_checklist_item` — manage checklist items and promote them to tasks.
- `atlas_create_subtask`, `atlas_promote_subtask` — create or promote full subtasks.

Task read/write protocol:

1. Discover workspace, project, board, and column.
2. Use readable task IDs returned by Atlas, such as `ATL-42`, for follow-up operations.
3. Before planning from or modifying a task, retrieve full task detail with `atlas_get_task` using `detail: "full"`; if the task has structured context, also read relevant checklists, subtasks, references, backlinks, task attachments metadata via `atlas_list_task_attachments`, and activity.
4. Preserve existing fields unless the user asked to change them.
5. Treat labels/tags as user-facing vocabulary: list existing labels/tags before inventing new ones when consistency matters.
6. Prefer references/subtasks/checklists over flattening all context into a single task description when Atlas structure better represents the work.

### Workspace structure writes

Use these only when the user asks to manage Atlas structure:

- `atlas_create_board`, `atlas_update_board`, `atlas_delete_board`.
- `atlas_create_column`, `atlas_update_column`, `atlas_delete_column`.
- `atlas_create_project`, `atlas_update_project`, `atlas_delete_project`.
- `atlas_create_tag`, `atlas_update_tag`, `atlas_delete_tag`.
- `atlas_create_status_template`, `atlas_update_status_template`, `atlas_delete_status_template`.
- `atlas_create_saved_search`, `atlas_rename_saved_search`, `atlas_delete_saved_search`.
- `atlas_create_task_view`, `atlas_update_task_view`, `atlas_delete_task_view`.

These operations affect shared workspace organization. Confirm intent, discover existing structure first, and avoid creating duplicates.

## MCP Coverage Limits

Use Atlas only through MCP. Atlas MCP intentionally does not cover every Atlas capability. If the user asks for an operation that is not exposed by the available MCP tools, ask for guidance or report the operation as unsupported in the current environment; do not use alternate Atlas interfaces or local client fallbacks.

Common MCP gaps include:

- no prompt capability;
- no user/admin management tools;
- no API-key management tools;
- no group, grant, or property-definition tools;
- no workspace create/update/admin-delete tools;
- no webhook, integration-config, or automation-rule tools;
- no attachment upload/download/delete tools through MCP; MCP lists attachment metadata only.

## Persistence Boundaries

Use Atlas for:

- durable user-facing notes and task/project records;
- workspace knowledge that should be visible in the Atlas web UI;
- task status, references, assignees, labels, checklists, and subtasks;
- human-readable documentation when the user names Atlas as the destination;
- SDD full human-readable artifacts when Atlas is selected/defaulted by preflight and approved for writes;
- project planning records that should be shared beyond the current Pi session.

Do not use Atlas for:

- Pi harness runtime configuration;
- subagent model assignments or `/agents` state;
- Engram memory observations or lifecycle metadata;
- Obsidian vault maintenance unless the user asks to import/export or sync with Atlas;
- repository file-backed OpenSpec artifacts unless the user explicitly requests file-backed SDD output.

For SDD flows, Atlas plus Engram are the default/new Pi Harness persistence path: Atlas stores the full human-readable artifact at logical path `sdd/<change>/<phase>.md`, while Engram stores the stable topic-key summary and pointer. Obsidian remains a legacy/fallback human backend only when explicitly selected. File-backed/OpenSpec artifacts remain opt-in only.

Atlas task tracking is separate from artifact persistence, remains explicit, and is parent-owned. Normal SDD phase agents do not create, update, move, label, hydrate, or otherwise mutate human Atlas tasks, epics, subtasks, boards, or columns. Parent-owned task mutation requires an explicit user request and approved contract, discovered workspace/project/board/column targets, and full task hydration before update.

When an Atlas write succeeds and the result matters for future agent context, save a concise Engram Atlas pointer afterward with the workspace, object type, slug/readable ID, revision when applicable, logical path, and why it matters. Never save a pointer that claims an Atlas write succeeded when Atlas was unavailable, unapproved, or conflicted.

## Safety Checklist

Before mutating Atlas, confirm:

- Target workspace/project/board/column/document/task was discovered, not guessed.
- The operation matches the user's requested destination and scope.
- Document content edits are based on the latest revision ID.
- PATCH fields are intentionally omitted, set, or cleared.
- Destructive actions have explicit user confirmation and the required confirmation flag.
- No secret values will be printed, logged, saved to Engram, or copied into documents/tasks.

If any item is uncertain, ask the user or perform another read-only discovery step before writing.

## Relationship to Other Persistence Backends

| Backend | Primary role | Default for |
|---|---|---|
| Engram | Agent/session memory and SDD recovery pointers | durable agent context, summaries, decisions, SDD topic keys |
| Atlas | Collaborative workspace knowledge and tasks | default/new full SDD artifacts, user-facing documents, boards, tasks, workspace records |
| Obsidian | Human-readable local notes/artifacts | explicit legacy/fallback SDD artifacts and vault notes |
| OpenSpec/files | Repository-tracked specs | explicit file-backed or team-reviewable SDD artifacts |
