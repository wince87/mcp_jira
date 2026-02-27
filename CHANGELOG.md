# Changelog

All notable changes to this project will be documented in this file.

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
