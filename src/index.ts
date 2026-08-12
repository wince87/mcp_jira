#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs, ToolHandler } from './types.js';
import { SERVER_VERSION } from './config.js';
import { handleError } from './errors.js';
import { PROMPTS } from './prompts.js';
import { TOOL_DEFINITIONS } from './tools/definitions.js';
import {
  handleCreateIssue, handleGetIssue, handleUpdateIssue, handleDeleteIssue, handleCreateSubtask,
  handleAssignIssue, handleCloneIssue, handleLinkIssues, handleGetChangelog,
} from './tools/issues.js';
import { handleSearchIssues, handleGetUserIssues } from './tools/search.js';
import { handleAddComment, handleUpdateComment, handleDeleteComment, handleGetComments } from './tools/comments.js';
import { handleAddWorklog, handleGetWorklogs, handleUpdateWorklog, handleDeleteWorklog } from './tools/worklogs.js';
import { handleListTransitions } from './tools/transitions.js';
import {
  handleGetAttachments, handleAddAttachment, handleDownloadAttachment, handleViewAttachment,
} from './tools/attachments.js';
import {
  handleGetProjectInfo, handleListProjects, handleGetProjectComponents, handleGetProjectVersions,
} from './tools/projects.js';
import {
  handleGetFields, handleGetIssueTypes, handleGetCreateFields, handleGetPriorities, handleGetLinkTypes,
} from './tools/metadata.js';
import {
  handleSearchUsers, handleGetMyself, handleAddWatcher, handleRemoveWatcher, handleGetWatchers,
} from './tools/users.js';
import {
  handleListBoards, handleListSprints, handleGetSprint, handleMoveToSprint, handleListEpics, handleGetEpic,
  handleGetEpicIssues, handleGetBoardEpics, handleAddIssuesToEpic, handleRemoveIssueFromEpic, handleCreateEpic,
} from './tools/agile.js';
import { handleListFilters, handleGetFilter, handleSearchByFilter } from './tools/filters.js';
import { handleBulkCreateIssues, handleBulkTransitionIssues } from './tools/bulk.js';

const server = new Server(
  {
    name: 'jira-mcp-server',
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, description: p.description })),
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = PROMPTS[request.params.name];
  if (!prompt) throw new Error(`Unknown prompt: ${request.params.name}`);
  return {
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: prompt.text },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

const toolHandlers: Record<string, ToolHandler> = {
  jira_create_issue: handleCreateIssue,
  jira_get_issue: handleGetIssue,
  jira_search_issues: handleSearchIssues,
  jira_update_issue: handleUpdateIssue,
  jira_add_comment: handleAddComment,
  jira_update_comment: handleUpdateComment,
  jira_delete_comment: handleDeleteComment,
  jira_link_issues: handleLinkIssues,
  jira_get_project_info: handleGetProjectInfo,
  jira_delete_issue: handleDeleteIssue,
  jira_create_subtask: handleCreateSubtask,
  jira_assign_issue: handleAssignIssue,
  jira_list_transitions: handleListTransitions,
  jira_add_worklog: handleAddWorklog,
  jira_get_comments: handleGetComments,
  jira_get_worklogs: handleGetWorklogs,
  jira_update_worklog: handleUpdateWorklog,
  jira_delete_worklog: handleDeleteWorklog,
  jira_list_projects: handleListProjects,
  jira_get_project_components: handleGetProjectComponents,
  jira_get_project_versions: handleGetProjectVersions,
  jira_get_fields: handleGetFields,
  jira_get_issue_types: handleGetIssueTypes,
  jira_get_create_fields: handleGetCreateFields,
  jira_get_priorities: handleGetPriorities,
  jira_get_link_types: handleGetLinkTypes,
  jira_search_users: handleSearchUsers,
  jira_get_changelog: handleGetChangelog,
  jira_get_user_issues: handleGetUserIssues,
  jira_bulk_create_issues: handleBulkCreateIssues,
  jira_clone_issue: handleCloneIssue,
  jira_list_boards: handleListBoards,
  jira_list_sprints: handleListSprints,
  jira_get_sprint: handleGetSprint,
  jira_move_to_sprint: handleMoveToSprint,
  jira_get_attachments: handleGetAttachments,
  jira_add_attachment: handleAddAttachment,
  jira_list_epics: handleListEpics,
  jira_get_epic: handleGetEpic,
  jira_get_epic_issues: handleGetEpicIssues,
  jira_get_board_epics: handleGetBoardEpics,
  jira_add_issues_to_epic: handleAddIssuesToEpic,
  jira_remove_issue_from_epic: handleRemoveIssueFromEpic,
  jira_create_epic: handleCreateEpic,
  jira_get_myself: handleGetMyself,
  jira_add_watcher: handleAddWatcher,
  jira_remove_watcher: handleRemoveWatcher,
  jira_get_watchers: handleGetWatchers,
  jira_download_attachment: handleDownloadAttachment,
  jira_view_attachment: handleViewAttachment,
  jira_list_filters: handleListFilters,
  jira_get_filter: handleGetFilter,
  jira_search_by_filter: handleSearchByFilter,
  jira_bulk_transition_issues: handleBulkTransitionIssues,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = toolHandlers[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  try {
    return await handler((args ?? {}) as ToolArgs);
  } catch (error) {
    return handleError(error);
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jira MCP Server running on stdio');
}

main().catch((error: Error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
