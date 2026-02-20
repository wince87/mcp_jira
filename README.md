# Jira MCP Server v2.3.2

Model Context Protocol (MCP) server for Jira API integration with automatic Markdown-to-ADF conversion.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## Features

- 32 Jira API tools via MCP protocol
- Automatic Markdown to ADF conversion (write Markdown, get proper Jira formatting)
- ADF to Markdown conversion when reading issues and comments
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

### Option 2: .env file

Create a `.env` file in the directory where you run the server:

```bash
JIRA_HOST=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=YOUR-PROJECT-KEY
JIRA_STORY_POINTS_FIELD=customfield_10016
```

Then run:

```bash
npx @mcpio/jira
```

## Formatting

All description and comment fields accept standard Markdown:

```markdown
# Heading
**bold** *italic* ~~strike~~ `code`
[link text](https://example.com)
- bullet item
1. numbered item
> blockquote
```

Automatically converted to Atlassian Document Format (ADF).

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
- `jira_get_comments` - Get issue comments
- `jira_link_issues` - Link two issues
- `jira_list_transitions` - Get available status transitions
- `jira_get_changelog` - Get issue change history
- `jira_add_worklog` - Add time tracking entry
- `jira_get_worklogs` - Get worklog entries
- `jira_get_attachments` - List attachments on an issue
- `jira_add_attachment` - Attach a local file to an issue

### Sprint & Board Management
- `jira_list_boards` - List all Scrum/Kanban boards
- `jira_list_sprints` - List sprints for a board
- `jira_get_sprint` - Get sprint details with all issues
- `jira_move_to_sprint` - Move issues to a sprint

### Project Management
- `jira_list_projects` - List all projects
- `jira_get_project_info` - Get project details
- `jira_get_project_components` - Get project components
- `jira_get_project_versions` - Get project versions/releases

### Metadata
- `jira_get_fields` - Get all fields (find custom field IDs)
- `jira_get_issue_types` - Get issue types for project
- `jira_get_priorities` - Get available priorities
- `jira_get_link_types` - Get issue link types
- `jira_search_users` - Search users by name/email
- `jira_get_user_issues` - Get all issues assigned to a user

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_HOST` | Yes | Jira instance URL (HTTPS). Alias: `JIRA_URL` |
| `JIRA_EMAIL` | Yes | Your Atlassian account email |
| `JIRA_API_TOKEN` | Yes | API token from Atlassian |
| `JIRA_PROJECT_KEY` | No | Default project key used when not specified in tool calls (e.g. `MYPROJECT`) |
| `JIRA_STORY_POINTS_FIELD` | No | Custom field ID for story points (defaults to `customfield_10016`) |

## Development

```bash
npm run build
npm start
```

## License

MIT - see [LICENSE](LICENSE) file

## Author

Volodymyr Press - [volodymyr.press.gpt@gmail.com](mailto:volodymyr.press.gpt@gmail.com)
