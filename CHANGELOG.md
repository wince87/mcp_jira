# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `jira_get_create_fields(projectKey, issueType)` — the missing second createmeta step. Returns every field on the create screen with `fieldId`, `name`, `required`, `type`, `custom` and `allowedValues`, plus a `requiredFields` shortlist. Previously `jira_get_issue_types` stopped at the type list, so the fields a screen demands could only be guessed at. Total tools: 54.
- First-class create/update fields on `jira_create_issue`, `jira_create_subtask`, `jira_create_epic` and `jira_update_issue`: `versions` (Affects versions), `fixVersions`, `components`, `parent`, `assignee`, `reporter`, `dueDate`, `timetracking`, `labels`. Shaped for the Jira API automatically (`versions: [{name}]` or `[{id}]` for numeric input, `parent: {key}`, `assignee: {accountId}`, `components: [{name}]`). Bug screens that require Affects versions can now be filled through MCP.
- `dryRun` on `jira_create_issue`, `jira_create_subtask` and `jira_create_epic` — validates the payload against createmeta and returns `missingRequired`, `invalidValues` and `fieldsNotOnScreen` without creating anything.
- `transitionId` and `transitionFields` on `jira_update_issue`, for workflows whose transition screens require input (e.g. an estimate on "Start work").
- `includeFields` on `jira_list_transitions` — expands each transition with its screen fields (required flags, types, allowed values) and a `requiredFields` shortlist.
- `fields` and `includeCustomFields` on `jira_get_issue`. `fields` maps to the Jira `?fields=` parameter; `includeCustomFields` adds a `customFields` map of every populated `customfield_NNNNN` with its human-readable name, type and value (rich-text rendered as Markdown).
- `customFieldsMarkdown` on all create paths and `jira_update_issue` — Markdown values converted to ADF explicitly.
- Create tools return the created issue's fields (`issue`), not just `key` and `url`.

### Changed
- 400 responses from create, update and transition calls are now enriched from createmeta / editmeta / the transition screen: `missingRequired`, `invalidValues`, `allowedValues` for fields named in the error, `fieldsNotOnScreen` and `transitionFields`. Jira's own text names neither the missing fields nor the accepted values, which previously turned one failed call into a guessing loop.
- `priority` accepts an id or a name. Names are localized on non-English instances while Jira only accepts the canonical English name, so a name is now matched against createmeta allowed values (localized) and the project priority list, and sent as `{id}`. `jira_get_priorities` documents that the id is what to pass.
- `issueType` accepts an id or a name and is resolved to `{id}` through createmeta, so localized type names work.
- `jira_update_issue` matches `status` against each transition's **target status** first, then the transition name, case-insensitively. Workflows that name transitions differently from their target statuses ("Start work (estimate)" -> "In Progress") no longer fail to find the transition. The not-found warning now lists `name -> target (id)`.
- Rich-text custom fields (`schema.type` `doc`, e.g. a "For QA" field) accept a plain Markdown string in `customFields` and are converted to ADF with the same converter used for descriptions and comments.
- `jira_get_issue` returns `resolution`, `components`, `versions`, `fixVersions`, `dueDate` and `timetracking` by default.
- `labels` is sent only when provided, instead of always sending `[]` — matches how `priority` was handled in 2.8.0 and avoids rejections on screens without the Labels field.
- `jira_create_subtask` discovers the project's subtask issue type instead of hardcoding `Subtask`, so instances using `Sub-task` or a localized name work. Accepts an explicit `issueType` to override.
- `jira_create_epic` sends the classic Epic Name field (`customfield_10011`) only when the create screen actually has it.
- Createmeta, issue types, field definitions and priorities are cached for 5 minutes, so the added metadata lookups cost at most one round trip per project/issue type.

## [2.8.0] - 2026-06-15

### Added
- `customFields` parameter on `jira_create_issue`, `jira_update_issue`, `jira_create_subtask`, `jira_create_epic`, `jira_bulk_create_issues`, and `jira_clone_issue` — set mandatory/custom fields keyed by field ID. Keys validated against `^customfield_\d{1,19}$` (blocks overriding system fields); values pass through to the Jira API as-is. Unblocks projects that require custom fields on the create screen (e.g. "Type of Team is required").
- `jira_view_attachment` — fetch an image attachment and return it inline as an MCP image block so the model can see it, no file written. Image mime types only, capped at 5MB. Total tools: 53.
- Image embedding in Markdown (converted to ADF media nodes): `![alt](media:<attachmentId>)` for attachment-backed images, `![alt](https://...)` for external images. Must be on their own line.
- `includeImages` parameter on `jira_get_issue` — returns up to 10 image attachments (image/*, each <=5MB) as inline images, embedded-in-description ones first.

### Changed
- `priority` is no longer forced to `Medium` on create. It is sent only when explicitly provided, so issues can be created on screens that do not expose the Priority field (Jira rejects fields not on the screen). Affects `jira_create_issue`, `jira_create_subtask`, `jira_create_epic`, `jira_bulk_create_issues`; `jira_clone_issue` now copies the source priority only when set.
- ADF reading: media nodes render as `[image: <alt|id>]` instead of bare `[media]`.

### Fixed
- `jira-backlog-grooming` prompt: typo "Unpriotitized" → "Unprioritized"; the unprioritized heuristic now also covers issues with no priority set (relevant now that create no longer forces Medium).

## [2.7.0] - 2026-04-30

### Added
- `jira_update_worklog` — update existing worklog entry (timeSpent, comment, started). Mirrors `jira_update_comment` pattern.
- `jira_delete_worklog` — permanent delete of a worklog entry.
- `jira-worklog-maintenance` MCP prompt — workflow for editing/deleting worklog entries.

### Fixed
- `handleAddWatcher`: self-watch path was sending JSON `null` as POST body, which Jira rejects with 400. Now sends `''` (empty string) per the API contract. Watcher add for the authenticated user works again.
- `handleGetEpicIssues`: response field `inProgress` was incorrectly counting all non-done issues (including `To Do`). Now split into `todo` / `inProgress` / `done` based on `statusCategory.key` (`new` / `indeterminate` / `done`). The `jira-epic-health` prompt downstream gets accurate traffic-light data.

### Security
- Bump `axios` 1.15.0 → 1.15.2 (patch update; no new direct CVEs but stays current).
- Transitive `hono` CVE GHSA-458j-xx4x-4375 (XSS in hono/jsx SSR) cleared via dedupe on reinstall. We do not use jsx/SSR; the path was unreachable.

## [2.6.2] - 2026-04-15

### Fixed
- `SERVER_VERSION` constant synced with `package.json` version. In 2.6.1 it remained at `2.6.0` because the version bump script only touches `package.json`. Server `initialize` response now returns the correct version.

## [2.6.1] - 2026-04-14

### Added
- 32 new MCP prompts (33 total) — every one of the 50 tools is now referenced in at least one workflow prompt. Grouped below:
  - **Planning**: `jira-epic-breakdown`, `jira-subtask-breakdown`, `jira-sprint-planning`, `jira-version-planning`, `jira-clone-template`, `jira-bulk-create`, `jira-epic-reorg`
  - **Triage & cleanup**: `jira-bug-triage`, `jira-backlog-grooming`, `jira-duplicate-detector`, `jira-estimation-helper`, `jira-issue-cleanup`, `jira-comment-maintenance`
  - **Status & reporting**: `jira-standup-prep`, `jira-sprint-summary`, `jira-weekly-report`, `jira-release-notes`, `jira-epic-health`
  - **Analysis**: `jira-dependency-map`, `jira-velocity-check`, `jira-workload-balance`, `jira-retro-data`, `jira-worklog-summary`
  - **Lookup**: `jira-user-lookup`, `jira-changelog-audit`, `jira-field-discovery`, `jira-project-overview`
  - **Operations**: `jira-bulk-transition`, `jira-attachment-review`, `jira-watcher-management`, `jira-saved-views`, `jira-worklog-entry`
- Enhanced tool descriptions with explicit cross-refs (e.g., `jira_create_issue` hints to call `jira_get_issue_types` / `jira_get_priorities` first; `jira_assign_issue` explains how to resolve accountId via `jira_search_users` / `jira_get_myself`; `jira_add_worklog` clarifies ISO 8601 format)

### Notes
- 100% tool coverage by prompts verified by grep (every `jira_*` tool name appears in at least one prompt text)

### Changed
- Refactored prompt handlers: single `PROMPTS` map replaces hard-coded handler branches (easier to extend)

## [2.6.0] - 2026-04-14

### Added
- 9 new tools targeted at AI-agent use cases:
  - `jira_get_myself` — authenticated user details (accountId, email, timezone)
  - `jira_add_watcher` — subscribe user to an issue; omitting accountId adds the authenticated user
  - `jira_remove_watcher` — unsubscribe a user
  - `jira_get_watchers` — list watchers with isWatching flag and count
  - `jira_download_attachment` — fetch attachment by ID and save to a local path (restricted to cwd/home)
  - `jira_list_filters` — search saved JQL filters by name or owner
  - `jira_get_filter` — get filter metadata (JQL, description, owner, favourite status)
  - `jira_search_by_filter` — resolve a filter's JQL and execute it; supports token pagination
  - `jira_bulk_transition_issues` — apply one transition across many issues, with optional comment and per-issue success/failure report

### Notes
- Tool count: 41 → 50
- `jira_bulk_transition_issues` supports both `transitionId` (fast, assumes every issue has the same ID) and `transitionName` (looked up per-issue, robust across workflows).
- `jira_download_attachment` requires the `savePath` to be inside the process cwd or user home — same policy as `jira_add_attachment`.

## [2.5.0] - 2026-04-08

### Security
- Bump `axios` to `1.15.0` (from `1.14.0`) to patch:
  - GHSA-3p68-rc4w-qgx5 — SSRF via NO_PROXY hostname normalization bypass (critical)
  - GHSA-fvcv-3m26-pcqx — unrestricted cloud metadata exfiltration via header injection (critical)

### Added
- 7 new Epic management tools:
  - `jira_list_epics` — list epics in a project (JQL-based, supports status filter and pagination)
  - `jira_get_epic` — fetch epic metadata via Agile API (name, summary, color, done status)
  - `jira_get_epic_issues` — list all child issues of an epic with progress (done/inProgress counts)
  - `jira_get_board_epics` — list epics on a Scrum/Kanban board, filterable by `done`
  - `jira_add_issues_to_epic` — bulk-link issues to an epic via Agile API
  - `jira_remove_issue_from_epic` — unlink issues from their current epic (POST to `/epic/none/issue`)
  - `jira_create_epic` — create epic with Epic Name customfield for classic (company-managed) projects
- `JiraStatusCategory.key` field in typings for done/in-progress detection

### Notes
- Tool count: 34 → 41
- Epic Name field (`customfield_10011`) is set by `jira_create_epic` — required by classic projects, ignored by team-managed projects. If your Jira uses a different custom field ID, create epics via `jira_create_issue` with `issueType: 'Epic'` and set the right field separately.

## [2.4.0] - 2026-04-08

### Breaking
- **Removed automatic `.env` file loading.** The server now reads configuration only from `process.env`. Users who passed credentials via MCP client config (`env: {...}` in Claude Desktop / Cursor / VS Code / Claude Code config) are unaffected. Users who relied on a local `.env` file when running `npx @mcpio/jira` directly should source it via shell first: `set -a; source .env; set +a; npx @mcpio/jira`.

### Security
- Removed `readFileSync('.env')` from startup to reduce Socket supply-chain capability surface
- Removed example URL strings from `jira-formatting-guide` MCP prompt (Socket "URL strings" alert)

### Removed
- `.env.example` file (no longer relevant)

## [2.3.11] - 2026-04-08

### Security
- Pin `@modelcontextprotocol/sdk` to exact version `1.29.0` (was `^1.29.0`) to prevent accidental install of compromised upstream versions
- Add GitHub Actions publish workflow with **npm provenance** (sigstore OIDC attestation). Releases pushed as `v*` tags now auto-publish with cryptographic proof that the tarball was built from the tagged commit in this repo

## [2.3.10] - 2026-04-08

### Security
- Pin `axios` to exact version `1.14.0` (was `^1.14.0`) to mitigate the `axios@1.14.1` supply-chain compromise. Attacker took over maintainer's npm account and published a malicious `1.14.1` that pulled in `plain-crypto-js` with a hidden `postinstall` payload. Although `1.14.1` has been removed from the registry, pinning prevents any accidental install if it reappears under the same version.

## [2.3.9] - 2026-04-08

### Changed
- Update author contact email to `vladimpress@gmail.com`

## [2.3.8] - 2026-02-27

### Security
- **Path traversal** in `jira_add_attachment`: restrict file paths to current working directory or user home (previous check `startsWith('/')` was a no-op on Unix)
- **JQL injection** in `jira_get_user_issues`: `projectKey` now quoted in JQL; `accountId` validated against Atlassian format (`/^[a-zA-Z0-9:._-]{1,128}$/`)
- **CVE fixes**: upgrade `@modelcontextprotocol/sdk` to `^1.29.0` — fixes ReDoS (GHSA-8r9q-7v3j-jr4g), cross-client data leak (GHSA-345p-7cg4-v4c7, CVSS 7.1), and DNS rebinding (GHSA-w48q-cv73-mx4w)
- `jira_assign_issue`: `accountId` now validated with `validateAccountId`

### Fixed
- Null guards on `response.data.values` / `response.data.issues` across all list endpoints (prevents `TypeError` on empty/missing responses)
- `jira_link_issues`: robust duplicate-link detection via regex instead of exact string match
- `jira_add_worklog`: `started` field now validated as ISO 8601 with timezone offset
- `jira_add_attachment`: explicit `multipart/form-data` Content-Type
- `jira_search_issues` / `jira_get_user_issues`: renamed `total` → `count` (accurate naming — `/search/jql` no longer returns total)

### Changed
- Full TypeScript strict typing: eliminated all `any` from handlers and response mapping
- Introduced typed interfaces for Jira API responses (`JiraIssue`, `JiraComment`, `JiraWorklog`, `JiraTransition`, `JiraChangelogHistory`, `JiraProject`, `JiraBoard`, `JiraSprint`, etc.)
- `ToolHandler` type now uses `Record<string, unknown>` instead of `Record<string, any>`
- Upgrade `axios` to `^1.14.0`

## [2.3.7] - 2026-02-27

### Added
- Changelog section in README for npm package page visibility

## [2.3.6] - 2026-02-27

### Fixed
- `jira_get_issue_types` — response parsing: `/issue/createmeta/{project}/issuetypes` returns `values`, not `issueTypes`
- `jira_search_issues` — `/search/jql` no longer returns `total` field; now uses `isLast` + `nextPageToken`
- `jira_get_user_issues` — same `/search/jql` response fix
- `SERVER_VERSION` constant synced with package.json

### Added
- `jira_search_issues` — `nextPageToken` input parameter for token-based pagination

## [2.3.5] - 2026-02-25

### Added
- `jira_update_comment` — update an existing comment (Markdown → ADF)
- `jira_delete_comment` — delete a comment by ID
- Markdown table example in README formatting guide

### Fixed
- `commentId` validation: `validateSafeParam` blocks path traversal (`/`, `\`)
- `resolveProjectKey` applied consistently in `jira_get_project_info`
- `orderBy` injection in `jira_get_comments`: restricted to enum whitelist (`created` / `-created`)
- `issueType`/`priority` validated with `validateSafeParam` in `jira_bulk_create_issues`

## [2.3.4] - 2026-02-24

### Added
- Markdown table → ADF table conversion
- ADF table → Markdown table conversion (bidirectional)

## [2.3.3] - 2026-02-20

### Fixed
- README: added example value for `JIRA_PROJECT_KEY`

## [2.3.2] - 2026-02-18

### Fixed
- README: version header, env var descriptions, setup examples
- README: added `JIRA_STORY_POINTS_FIELD` to config examples, `npx` in `.env` option

## [2.3.1] - 2026-02-18

### Fixed
- README: MCP client config as primary setup method

## [2.3.0] - 2026-02-18

### Added
- `jira_get_changelog` — full change history with author, date, field diffs
- `jira_get_user_issues` — all issues assigned to a specific user
- `jira_bulk_create_issues` — create up to 50 issues in one call
- `jira_clone_issue` — clone issue with optional new summary and target project
- `jira_get_attachments` — list attachments on an issue
- `jira_add_attachment` — attach a local file to an issue
- `jira_list_boards` — list all Scrum/Kanban boards
- `jira_list_sprints` — list sprints for a board (active/future/closed)
- `jira_get_sprint` — sprint details with all issues
- `jira_move_to_sprint` — move issues to a sprint

### Fixed
- `SERVER_VERSION` constant now matches package version
- `resolveProjectKey()` helper eliminates duplicated expressions
- JQL injection prevention in `jira_get_user_issues`
- `state` enum validation in `jira_list_sprints`
- Path traversal prevention in `jira_add_attachment`

## [2.2.2] - 2026-02-18

### Fixed
- Removed `dotenv` dependency to fix `npx` stdout pollution (`[dotenv@17...]` broke MCP JSON protocol)

### Changed
- Extracted 22 tool handlers from single switch into separate functions (SOLID/SRP)
- Merged duplicate `addBulletItem` + `addOrderedItem` into `addListItem` (DRY)
- `validateSafeParam` delegates to `sanitizeString` (DRY)
- Fixed `validateProjectKey` regex to allow single-character keys
- Removed unreachable dead code in `parseInlineContent`

## [2.2.1] - 2026-02-17

### Fixed
- Removed `dotenv` dependency to fix `npx` stdout pollution
- Code quality refactoring (SOLID/DRY/KISS)

## [2.2.0] - 2026-02-13

### Changed
- `POST /rest/api/3/search` → `GET /rest/api/3/search/jql` (old endpoint removed by Atlassian, returns 410)
- `GET /rest/api/3/priority` → `GET /rest/api/3/priority/search` (deprecated endpoint replaced)

## [2.1.1] - 2026-02-09

### Added
- Full TypeScript rewrite with strict mode
- 14 new tools (23 total): `jira_assign_issue`, `jira_list_transitions`, `jira_add_comment`, `jira_get_comments`, `jira_add_worklog`, `jira_get_worklogs`, `jira_link_issues`, `jira_create_subtask`, `jira_list_projects`, `jira_get_project_info`, `jira_get_project_components`, `jira_get_project_versions`, `jira_get_fields`, `jira_get_issue_types`, `jira_get_priorities`, `jira_get_link_types`, `jira_search_users`
- Automatic Markdown → ADF conversion for descriptions and comments
- Automatic ADF → Markdown conversion when reading issues
- HTTPS enforcement, input validation, safe parameter handling

### Fixed
- Entry point backward compatibility after TypeScript conversion
- `jira_get_issue`: include labels, story points, assignee accountId
- `jira_search_issues`: include labels, assignee accountId
- `handleError`: always return Jira API error details

## [1.0.0] - 2025-10-30

### Added
- Initial release
- 9 basic Jira API tools: `jira_create_issue`, `jira_get_issue`, `jira_search_issues`, `jira_update_issue`, `jira_delete_issue`, `jira_create_subtask`, `jira_get_project_info`, `jira_delete_issue`
- MCP stdio transport
- Basic authentication with Jira Cloud API v3
