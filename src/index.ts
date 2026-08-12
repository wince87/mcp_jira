#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema, ListToolsRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema,
  ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema,
  CompleteRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolArgs } from './types.js';
import { SERVER_VERSION } from './config.js';
import { handleError } from './errors.js';
import { PROMPTS, renderPrompt } from './prompts.js';
import { RESOURCE_TEMPLATES, readResource, staticResources } from './resources.js';
import { completionsFor } from './completions.js';
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
      tools: { listChanged: false },
      prompts: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      completions: {},
    },
  }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: Object.entries(PROMPTS).map(([name, p]) => (
      p.arguments ? { name, description: p.description, arguments: p.arguments } : { name, description: p.description }
    )),
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = PROMPTS[request.params.name];
  if (!prompt) throw new Error(`Unknown prompt: ${request.params.name}`);
  const args = (request.params.arguments ?? {}) as Record<string, string>;
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text: renderPrompt(prompt, args) },
      },
    ],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: staticResources() };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return { resourceTemplates: RESOURCE_TEMPLATES };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const contents = await readResource(uri);
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(contents, null, 2) }],
  };
});

server.setRequestHandler(CompleteRequestSchema, async (request) => {
  const values = await completionsFor(request.params.argument.name, request.params.argument.value);
  return { completion: { values, total: values.length, hasMore: false } };
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
