# Jira MCP Server with ADF Support

Model Context Protocol (MCP) server for Jira API integration with enhanced Atlassian Document Format (ADF) support.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)

## Features

- Full Jira API integration via MCP protocol
- Enhanced ADF formatting with **clickable issue links**
- Support for code blocks, lists, headers, and rich text formatting
- Complete CRUD operations: create, read, update, delete issues
- Issue linking, subtasks, comments, and JQL search
- Built-in security: input validation, HTTPS enforcement, error sanitization
- Automatic formatting prompts for AI models

## Installation

```bash
npm install jira-api-mcp
```

Or install globally:

```bash
npm install -g jira-api-mcp
```

## Setup

1. Create a `.env` file with your Jira credentials:

```bash
JIRA_HOST=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=YOUR-PROJECT-KEY
```

2. Get your Jira API token from: https://id.atlassian.com/manage-profile/security/api-tokens

3. Run the server:

```bash
jira-api-mcp
```

Or if installed locally:

```bash
npm start
```

## Formatting Guide

### Clickable Issue Links

**Format for clickable links:**
```
- [ISSUE-KEY|URL] Description
```

**Example:**
```
- [PROJ-123|https://your-domain.atlassian.net/browse/PROJ-123] Implement authentication
```

### Basic Formatting

```
h1. Heading Level 1
h2. Heading Level 2

* Bullet item
# Numbered item

*bold text*

----  (horizontal rule)

​```
Code block
​```
```

## Available Tools

- `jira_create_issue` - Create new issue
- `jira_get_issue` - Get issue details
- `jira_search_issues` - Search with JQL
- `jira_update_issue` - Update issue (description, status, summary)
- `jira_add_comment` - Add comment to issue
- `jira_link_issues` - Link two issues
- `jira_get_project_info` - Get project information
- `jira_delete_issue` - Delete issue
- `jira_create_subtask` - Create subtask under parent

## Environment Variables

- `JIRA_HOST` - Jira instance URL (HTTPS required)
- `JIRA_EMAIL` - Your email address
- `JIRA_API_TOKEN` - API token from Atlassian
- `JIRA_PROJECT_KEY` - Default project key (optional, defaults to "PROJ")

## License

MIT - see [LICENSE](LICENSE) file

## Author

Volodymyr Press - [volodymyr.press.gpt@gmail.com](mailto:volodymyr.press.gpt@gmail.com)
