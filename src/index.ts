#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from './types.js';
import { SERVER_VERSION } from './config.js';
import { handleError } from './errors.js';
import { PROMPTS } from './prompts.js';
import { handlerMap, listedTools } from './registry.js';
import { ISSUES_TOOLS } from './tools/issues.js';
import { SEARCH_TOOLS } from './tools/search.js';
import { COMMENTS_TOOLS } from './tools/comments.js';
import { PROJECTS_TOOLS } from './tools/projects.js';
import { TRANSITIONS_TOOLS } from './tools/transitions.js';
import { WORKLOGS_TOOLS } from './tools/worklogs.js';
import { METADATA_TOOLS } from './tools/metadata.js';
import { USERS_TOOLS } from './tools/users.js';
import { BULK_TOOLS } from './tools/bulk.js';
import { AGILE_TOOLS } from './tools/agile.js';
import { ATTACHMENTS_TOOLS } from './tools/attachments.js';
import { FILTERS_TOOLS } from './tools/filters.js';

const TOOLS = [
  ...ISSUES_TOOLS,
  ...SEARCH_TOOLS,
  ...COMMENTS_TOOLS,
  ...PROJECTS_TOOLS,
  ...TRANSITIONS_TOOLS,
  ...WORKLOGS_TOOLS,
  ...METADATA_TOOLS,
  ...USERS_TOOLS,
  ...BULK_TOOLS,
  ...AGILE_TOOLS,
  ...ATTACHMENTS_TOOLS,
  ...FILTERS_TOOLS,
];

const toolHandlers = handlerMap(TOOLS);

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
  return { tools: listedTools(TOOLS) };
});

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
