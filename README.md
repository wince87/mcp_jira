# Jira MCP Server v2.8.0

Model Context Protocol (MCP) server for Jira API integration with automatic Markdown-to-ADF conversion.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Features

- 75 Jira API tools via MCP protocol
- 34 pre-baked MCP prompts covering every tool (sprint planning, bug triage, epic health, standup, weekly reports, bulk ops, attachments, watchers, filters, reorg, etc.)
- Automatic Markdown to ADF conversion (write Markdown, get proper Jira formatting)
- ADF to Markdown conversion when reading issues and comments
- Full create screen introspection (`jira_get_create_fields`): required fields, types, allowed values — plus `dryRun` validation and 400 responses enriched with what was missing
- Custom field support on create/update/clone (set mandatory `customfield_NNNNN` fields), rich-text ones written as Markdown
- Works on non-English Jira instances: localized issue type, priority and status names are resolved to ids before sending
- Image support: view image attachments inline, embed images via Markdown, return embedded images when reading an issue
- Sprint and board management via Jira Agile API
- File attachment support
- Input validation, HTTPS enforcement, Jira error details in responses
- TypeScript source with full type definitions
- Zero runtime dependencies beyond MCP SDK and axios

## Setup

Get your API token: https://id.atlassian.com/manage-profile/security/api-tokens

### Option 1: MCP client config (recommended)

Add to your MCP client configuration (Claude Desktop, VS Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@mcpio/jira"],
      "env": {
        "JIRA_HOST": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token",
        "JIRA_PROJECT_KEY": "YOUR-PROJECT-KEY",
        "JIRA_STORY_POINTS_FIELD": "customfield_10016"
      }
    }
  }
}
```

### Option 2: Shell environment variables

Export variables in your shell and run directly:

```bash
export JIRA_HOST=https://your-domain.atlassian.net
export JIRA_EMAIL=your-email@example.com
export JIRA_API_TOKEN=your-api-token
export JIRA_PROJECT_KEY=YOUR-PROJECT-KEY
export JIRA_STORY_POINTS_FIELD=customfield_10016
npx @mcpio/jira
```

If you keep credentials in a `.env` file, source it in your shell before running:

```bash
set -a; source .env; set +a
npx @mcpio/jira
```

> **Note (v2.4.0+):** The server no longer reads `.env` files automatically. This reduces filesystem capability surface for supply-chain audits. Use shell `export` or MCP client config (Option 1) instead.

## Formatting

All description and comment fields accept standard Markdown:

```markdown
# Heading
**bold** *italic* ~~strike~~ `code`
[link text](https://example.com)
- bullet item
1. numbered item
> blockquote
| Header 1 | Header 2 |
|----------|----------|
| cell 1   | cell 2   |
```

Automatically converted to Atlassian Document Format (ADF).

Rich-text custom fields (`schema.type: "doc"`) also accept Markdown strings — pass them in `customFields`, or in `customFieldsMarkdown` to be explicit.

## Creating issues on an unfamiliar screen

Jira rejects a create when a mandatory field is missing, but its error names neither the field nor the values it accepts. Two calls remove the guesswork:

```
jira_get_issue_types   { projectKey: "PROJ" }                      -> issue types with ids
jira_get_create_fields { projectKey: "PROJ", issueType: "Bug" }    -> every field: required, type, allowedValues
```

Then create, passing ids where the screen offers a fixed set:

```json
{
  "summary": "Login fails on retry",
  "description": "Steps...",
  "issueType": "Bug",
  "versions": ["1.4.0"],
  "components": ["Auth"],
  "priority": "2",
  "customFields": { "customfield_10500": "**Check** the retry path" }
}
```

Add `"dryRun": true` to validate the payload without creating anything. If a create still fails, the 400 response carries `missingRequired`, `invalidValues` and `allowedValues` for the fields Jira complained about, so the next attempt is informed rather than guessed.

**Non-English instances:** `jira_get_priorities` and `jira_get_issue_types` return names in the account language (`Високий`, `Помилка`), but Jira only accepts the canonical English name or the id. Pass the **id**. Localized names are matched against the screen's allowed values and converted to ids automatically, so they work too — ids just skip the lookup.

**Status changes:** transitions are often named differently from the status they lead to ("Start work (estimate)" -> "In Progress"). `jira_update_issue` and `jira_bulk_transition_issues` match `status` against the target status first, then the transition name. If a transition screen requires input, list it with `jira_list_transitions { includeFields: true }` and pass the values via `transitionFields`.

## Rate limits and retries

Jira Cloud answers `429` with a `Retry-After` header when you exceed its rate limit. The server honours it and retries with exponential backoff plus jitter, up to `JIRA_MAX_RETRIES`.

The retry policy is deliberately asymmetric:

| Failure | Reads (`GET`) | Writes (`POST`/`PUT`/`DELETE`) |
|---------|---------------|-------------------------------|
| `429` rate limit | retried | retried — a rate-limited request never reached the handler |
| `5xx` server error | retried | **never retried** — the write may have been applied, and a second attempt could create a duplicate issue |
| Network error / timeout | retried | never retried |
| Any other `4xx` | not retried | not retried |

A `Retry-After` longer than 60 seconds is not honoured: the call fails immediately with the Jira error rather than blocking the agent for minutes.

Bulk operations run `JIRA_CONCURRENCY` requests in parallel and report results in input order, with a per-issue error for anything that failed.

## MCP Prompts

Pre-baked workflows your AI agent can invoke directly (via MCP `prompts/list` + `prompts/get`). Every one of the 75 tools is referenced in at least one prompt.

**Formatting & lookup**
- `jira-formatting-guide` - Markdown formatting rules for Jira (ADF)
- `jira-user-lookup` - Resolve accountId by name/email
- `jira-changelog-audit` - Audit history of an issue
- `jira-field-discovery` - Find custom field IDs and enum values
- `jira-project-overview` - Project snapshot for onboarding

**Planning**
- `jira-epic-breakdown` - Split an idea into an epic + stories + subtasks
- `jira-subtask-breakdown` - Break one story into implementation subtasks
- `jira-sprint-planning` - Pull next sprint from backlog by priority + capacity
- `jira-version-planning` - Plan contents of a fixVersion (release)
- `jira-clone-template` - Clone template issue with placeholder replacement
- `jira-bulk-create` - Scaffold many issues from a structured list
- `jira-epic-reorg` - Move issues between epics

**Triage & cleanup**
- `jira-bug-triage` - Triage open bugs (assign, prioritize, comment)
- `jira-backlog-grooming` - Find stale/unclear/duplicate backlog items
- `jira-duplicate-detector` - Find duplicates of a specific issue
- `jira-estimation-helper` - Estimate story points from similar past issues
- `jira-issue-cleanup` - Safely delete an issue with pre-flight audit
- `jira-comment-maintenance` - Edit or remove existing comments

**Status & reporting**
- `jira-standup-prep` - Daily standup notes (Yesterday / Today / Blockers)
- `jira-sprint-summary` - Status report for active sprint
- `jira-weekly-report` - Cross-project status for management
- `jira-release-notes` - User-facing notes from resolved issues in a version
- `jira-epic-health` - Traffic-light health per active epic

**Analysis**
- `jira-dependency-map` - Trace blockers (direct + transitive) for an issue
- `jira-velocity-check` - Team velocity over last N sprints
- `jira-workload-balance` - Per-assignee workload snapshot
- `jira-retro-data` - Sprint retro data (wins, misses, flow)
- `jira-worklog-summary` - Time logged by user/team over a period

**Operations**
- `jira-bulk-transition` - Mass status transition with per-issue report
- `jira-attachment-review` - List, download, add attachments on an issue
- `jira-watcher-management` - Manage watchers on an issue
- `jira-saved-views` - Find and run a saved Jira filter
- `jira-worklog-entry` - Log time for a single issue

## Available Tools

### Issue Management
- `jira_create_issue` - Create new issue
- `jira_get_issue` - Get issue details
- `jira_search_issues` - Search with JQL
- `jira_update_issue` - Update issue fields and status
- `jira_delete_issue` - Delete issue
- `jira_clone_issue` - Clone an existing issue
- `jira_create_subtask` - Create subtask
- `jira_bulk_create_issues` - Create multiple issues at once
- `jira_assign_issue` - Assign/unassign user
- `jira_add_comment` - Add comment
- `jira_update_comment` - Update existing comment
- `jira_delete_comment` - Delete comment
- `jira_get_comments` - Get issue comments
- `jira_link_issues` - Link two issues
- `jira_delete_issue_link` - Remove a link between two issues
- `jira_list_transitions` - Get available status transitions
- `jira_get_changelog` - Get issue change history
- `jira_add_worklog` - Add time tracking entry
- `jira_get_worklogs` - Get worklog entries
- `jira_update_worklog` - Update an existing worklog entry
- `jira_delete_worklog` - Delete a worklog entry
- `jira_get_attachments` - List attachments on an issue
- `jira_add_attachment` - Attach a local file to an issue
- `jira_delete_attachment` - Delete an attachment permanently
- `jira_get_edit_fields` - Get the edit screen for one issue (update-time mirror of `jira_get_create_fields`)
- `jira_get_remote_links` / `jira_add_remote_link` / `jira_delete_remote_link` - Web links (pull requests, Confluence pages)

### Sprint & Board Management
- `jira_list_boards` - List all Scrum/Kanban boards
- `jira_list_sprints` - List sprints for a board
- `jira_get_sprint` - Get sprint details with all issues
- `jira_move_to_sprint` - Move issues to a sprint
- `jira_create_sprint` - Create a sprint on a board
- `jira_update_sprint` - Rename, re-goal, re-date, or start/close a sprint via state
- `jira_delete_sprint` - Delete a sprint (issues return to the backlog)
- `jira_rank_issues` - Reorder issues in the backlog or on a board
- `jira_move_to_backlog` - Move issues out of a sprint

### Epic Management
- `jira_list_epics` - List all epics in a project
- `jira_get_epic` - Get epic details (name, color, done status)
- `jira_get_epic_issues` - Get all child issues linked to an epic with progress
- `jira_get_board_epics` - List epics on a board (filterable by done status)
- `jira_add_issues_to_epic` - Link one or more issues to an epic
- `jira_remove_issue_from_epic` - Unlink issues from their epic
- `jira_create_epic` - Create a new epic (sets issueType=Epic, handles classic Epic Name field)

### Project Management
- `jira_list_projects` - List all projects
- `jira_get_project_info` - Get project details
- `jira_get_project_components` - Get project components
- `jira_create_component` / `jira_update_component` / `jira_delete_component` - Manage components
- `jira_get_project_versions` - Get project versions/releases
- `jira_create_version` / `jira_update_version` / `jira_delete_version` - Manage versions (releasing is an update)

### Metadata
- `jira_get_fields` - Get all fields (find custom field IDs)
- `jira_get_project_statuses` - Statuses available per issue type
- `jira_list_labels` - Labels that already exist in the instance
- `jira_get_my_permissions` - What the current user may do, optionally scoped to a project or issue
- `jira_get_issue_types` - Get issue types for project
- `jira_get_create_fields` - Get the create screen for one issue type: required flags, types, allowed values
- `jira_get_priorities` - Get available priorities (pass the id, not the localized name)
- `jira_get_link_types` - Get issue link types
- `jira_search_users` - Search users by name/email
- `jira_get_user_issues` - Get all issues assigned to a user

### Watchers & Notifications
- `jira_get_myself` - Get the authenticated user (accountId, timezone, email)
- `jira_add_watcher` - Subscribe a user to an issue
- `jira_remove_watcher` - Unsubscribe a user from an issue
- `jira_get_watchers` - List all watchers on an issue

### Saved Filters
- `jira_list_filters` - Search saved filters by name or owner
- `jira_get_filter` - Get a filter (JQL, description, owner)
- `jira_search_by_filter` - Execute a saved filter and return matching issues

### Bulk Operations & Downloads
- `jira_bulk_transition_issues` - Apply the same status transition to multiple issues
- `jira_bulk_update_issues` - Apply the same field changes to multiple issues (add/remove labels without replacing)
- `jira_download_attachment` - Download an attachment to a local file

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_HOST` | Yes | Jira instance URL (HTTPS). Alias: `JIRA_URL` |
| `JIRA_EMAIL` | Yes | Your Atlassian account email |
| `JIRA_API_TOKEN` | Yes | API token from Atlassian |
| `JIRA_PROJECT_KEY` | No | Default project key used when not specified in tool calls (e.g. `MYPROJECT`) |
| `JIRA_STORY_POINTS_FIELD` | No | Custom field ID for story points (defaults to `customfield_10016`) |
| `JIRA_TIMEOUT_MS` | No | Per-request timeout in milliseconds (default `30000`) |
| `JIRA_MAX_RETRIES` | No | Retries after the first attempt (default `3`). Applies to rate limits, and to reads on server errors — never to writes on server errors |
| `JIRA_RETRY_BASE_MS` | No | Base backoff delay in milliseconds (default `500`), doubled per attempt with jitter |
| `JIRA_CONCURRENCY` | No | Parallel requests inside bulk operations (default `5`) |
| `JIRA_FORCE_ENGLISH` | No | Set to `true` to send `Accept-Language: en-US` with `X-Force-Accept-Language`, so Jira answers with canonical English names instead of the account language |

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

### Recent

- **2.8.0** — Added `customFields` on create/update/subtask/epic/bulk/clone (set mandatory `customfield_NNNNN`). Added `jira_view_attachment` (inline image view, 53 tools). Added Markdown image embedding (`![alt](media:<id>)`, external URLs) and `includeImages` on `jira_get_issue`. ADF media now reads as `[image: ...]`. Changed: `priority` no longer forced to Medium on create (sent only when provided).
- **2.7.0** — Added `jira_update_worklog` + `jira_delete_worklog` (52 tools). Fix: `handleAddWatcher` self-watch (was sending null body, now empty string). Fix: `handleGetEpicIssues` split status into todo / inProgress / done. Bump axios 1.15.0 → 1.15.2.
- **2.6.2** — Fix: `SERVER_VERSION` constant now matches package version (was stale at 2.6.0)
- **2.6.1** — Added 32 pre-baked MCP prompts (total 33) — every one of the 50 tools is now referenced in at least one workflow prompt. Enhanced cross-refs in tool descriptions (jira_create_issue, jira_update_issue, jira_assign_issue, jira_link_issues, jira_add_worklog).
- **2.6.0** — Added 9 tools: watchers (add/remove/list), current user (myself), saved filters (list/get/run), bulk transition, attachment download
- **2.5.0** — Added 7 Epic management tools: list, get, children, board epics, link/unlink, create
- **2.4.0** — **Breaking**: removed automatic `.env` file loading (`process.env` only). Removed URL literals from prompt. Added `socket.yml` to scope supply-chain alerts to direct code only.
- **2.3.11** — Pin `@modelcontextprotocol/sdk`; GitHub Actions publish workflow with npm provenance
- **2.3.10** — Security: pin `axios` to exact `1.14.0` (mitigates axios@1.14.1 supply-chain compromise)
- **2.3.9** — Update author contact email
- **2.3.8** — Security: fix path traversal in attachments, JQL injection; upgrade MCP SDK (3 CVEs); full TypeScript strict typing
- **2.3.7** — Add Changelog section to README for npm visibility
- **2.3.6** — Fix API mismatches: `search/jql` pagination, `createmeta` response parsing
- **2.3.5** — Add `jira_update_comment`, `jira_delete_comment`, security fixes
- **2.3.4** — Markdown table ↔ ADF conversion
- **2.3.0** — 10 new tools: sprints, boards, attachments, bulk create, changelog

## Development

```bash
npm run build
npm start
```

## License

MIT - see [LICENSE](LICENSE) file

## Author

Volodymyr Press - [vladimpress@gmail.com](mailto:vladimpress@gmail.com)
