#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

function getRequiredEnv(name, fallback = null) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set. Please check your .env file.`);
  }
  return value;
}

const JIRA_URL = getRequiredEnv('JIRA_HOST', process.env.JIRA_URL);
const JIRA_EMAIL = getRequiredEnv('JIRA_EMAIL');
const JIRA_API_TOKEN = getRequiredEnv('JIRA_API_TOKEN');
const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || 'PROJ';
const STORY_POINTS_FIELD = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';

if (!JIRA_URL.startsWith('https://')) {
  throw new Error('JIRA_HOST must use HTTPS protocol for security');
}

function validateIssueKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid issue key: must be a string');
  }
  if (!/^[A-Z]+-\d+$/.test(key)) {
    throw new Error(`Invalid issue key format: ${key}. Expected format: PROJECT-123`);
  }
  return key;
}

function validateJQL(jql) {
  if (!jql || typeof jql !== 'string') {
    throw new Error('Invalid JQL query: must be a string');
  }
  if (jql.length > 5000) {
    throw new Error('JQL query too long: maximum 5000 characters');
  }
  return jql;
}

function sanitizeString(str, maxLength = 1000, fieldName = 'input') {
  if (!str || typeof str !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  return str.trim();
}

function createSuccessResponse(data) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function createIssueUrl(issueKey) {
  return `${JIRA_URL}/browse/${issueKey}`;
}

function handleError(error) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  const errorResponse = {
    error: 'Operation failed',
    message: error.message || 'An unexpected error occurred',
  };

  if (isDevelopment) {
    errorResponse.details = error.response?.data;
    errorResponse.stack = error.stack;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(errorResponse, null, 2),
    }],
    isError: true,
  };
}

const jiraApi = axios.create({
  baseURL: `${JIRA_URL}/rest/api/3`,
  auth: {
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN,
  },
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

const server = new Server(
  {
    name: 'jira-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

function createADFDocument(content) {
  const nodes = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      continue;
    }

    if (line.startsWith('h1. ')) {
      nodes.push({
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: line.substring(4) }]
      });
    } else if (line.startsWith('h2. ')) {
      nodes.push({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: line.substring(4) }]
      });
    } else if (line.startsWith('h3. ')) {
      nodes.push({
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: line.substring(4) }]
      });
    } else if (line.startsWith('- [') && line.includes('|')) {
      const match = line.match(/- \[([^\]]+)\|([^\]]+)\] (.+)/);
      if (match) {
        nodes.push({
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: match[1],
                  marks: [{
                    type: 'link',
                    attrs: { href: match[2] }
                  }]
                },
                { type: 'text', text: ' ' + match[3] }
              ]
            }]
          }]
        });
      }
    } else if (line.startsWith('* ')) {
      nodes.push({
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: line.substring(2) }]
          }]
        }]
      });
    } else if (line === '----') {
      nodes.push({
        type: 'rule'
      });
    } else if (line === '```' || line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push({
        type: 'codeBlock',
        content: [{
          type: 'text',
          text: codeLines.join('\n')
        }]
      });
    } else if (line.includes('*') && line.includes(':')) {
      const parts = [];
      const regex = /\*([^*]+)\*/g;
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', text: line.substring(lastIndex, match.index) });
        }
        parts.push({
          type: 'text',
          text: match[1],
          marks: [{ type: 'strong' }]
        });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < line.length) {
        parts.push({ type: 'text', text: line.substring(lastIndex) });
      }

      nodes.push({
        type: 'paragraph',
        content: parts
      });
    } else if (line.startsWith('*') && line.endsWith('*')) {
      nodes.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: line.substring(1, line.length - 1),
          marks: [{ type: 'strong' }]
        }]
      });
    } else {
      nodes.push({
        type: 'paragraph',
        content: [{ type: 'text', text: line }]
      });
    }
  }

  return {
    type: 'doc',
    version: 1,
    content: nodes
  };
}

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'jira-formatting-guide',
        description: 'Essential Jira formatting rules for creating clickable links and properly formatted issues',
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name === 'jira-formatting-guide') {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `When working with Jira through this MCP server, you MUST ALWAYS follow these formatting rules:

CRITICAL: CLICKABLE ISSUE LINKS
================================
To create clickable links to Jira issues, ALWAYS use this exact format:
- [ISSUE-KEY|FULL-URL] Description text

CORRECT Examples:
- [PROJ-123|https://your-domain.atlassian.net/browse/PROJ-123] Implement authentication
- [PROJ-124|https://your-domain.atlassian.net/browse/PROJ-124] Add unit tests

WRONG (these will NOT be clickable):
- PROJ-123 Implement authentication (plain text)
- * PROJ-123 Implement authentication (plain bullet)
- [PROJ-123](https://...) (markdown format)

JIRA FORMATTING REFERENCE:
==========================
1. Headers:
   h1. Main Title
   h2. Section Title
   h3. Subsection

2. Lists:
   * Bullet point
   * Another bullet

   # Numbered item
   # Another number

3. Code Blocks:
   \`\`\`
   Error message or code here
   Multiple lines supported
   \`\`\`

4. Bold Text:
   *important text*

5. Horizontal Line:
   ----

IMPORTANT RULES:
================
1. NEVER reference Jira issues as plain text like "PROJ-123"
2. ALWAYS use the format: - [KEY|URL] description
3. ALWAYS include the full URL: https://domain.atlassian.net/browse/KEY
4. The dash and space before the bracket are REQUIRED: "- ["
5. Use the pipe character | to separate key from URL

When creating or updating Jira issues, descriptions, or comments, automatically apply this formatting without being asked.`,
          },
        },
      ],
    };
  }

  throw new Error(`Unknown prompt: ${request.params.name}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'jira_create_issue',
        description: `Create a new Jira issue with proper ADF formatting.

⚠️ CRITICAL - ALWAYS Use Jira Formatting:
When writing descriptions, ALWAYS format Jira issue references as clickable links:
- [PROJECT-123|https://your-domain.atlassian.net/browse/PROJECT-123] Description

NEVER use plain text like "PROJECT-123" - it won't be clickable!

Supported formatting:
- h1. h2. h3. for headers
- * for bullet lists
- \`\`\` for code blocks
- *text* for bold
- ---- for horizontal rule

See the 'jira-formatting-guide' prompt for complete reference.`,
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Issue summary/title',
            },
            description: {
              type: 'string',
              description: 'Issue description - use format: - [KEY|URL] text for clickable links',
            },
            issueType: {
              type: 'string',
              description: 'Issue type (Story, Task, Bug, etc.)',
              default: 'Task',
            },
            priority: {
              type: 'string',
              description: 'Priority (Highest, High, Medium, Low, Lowest)',
              default: 'Medium',
            },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels for the issue',
            },
            storyPoints: {
              type: 'number',
              description: 'Story points estimate',
            },
          },
          required: ['summary', 'description'],
        },
      },
      {
        name: 'jira_get_issue',
        description: 'Get details of a Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key (e.g., TTC-123)',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_search_issues',
        description: 'Search for Jira issues using JQL',
        inputSchema: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description: 'JQL query string',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results',
              default: 50,
            },
          },
          required: ['jql'],
        },
      },
      {
        name: 'jira_update_issue',
        description: `Update a Jira issue.

IMPORTANT - Description Formatting Guide:

The description field supports a special markup format that gets converted to Atlassian Document Format (ADF):

1. HEADINGS:
   h1. Heading 1
   h2. Heading 2
   h3. Heading 3
   h4. Heading 4
   h5. Heading 5

2. LISTS:
   * Bullet item (use asterisk + space)
   # Numbered item (use hash + space)

3. LINKS TO JIRA ISSUES (CREATES CLICKABLE LINKS):
   - [ISSUE-KEY|URL] Description text
   Example: - [PROJ-61|https://your-domain.atlassian.net/browse/PROJ-61] API rate limiting

   This format is CRITICAL for creating active hyperlinks to Jira issues!
   DO NOT use plain text like "PROJ-61" - it will not be clickable.
   DO NOT use markdown format [text](url) - it will not work.
   ALWAYS use the pipe format: [KEY|URL]

4. TEXT FORMATTING:
   *bold text* (asterisk before and after)

5. HORIZONTAL RULE:
   ---- (four dashes)

Example with links:
h2. Task List
h4. Security Tasks
- [PROJ-61|https://your-domain.atlassian.net/browse/PROJ-61] Implement rate limiting
- [PROJ-63|https://your-domain.atlassian.net/browse/PROJ-63] Configure CORS

This will create proper clickable links in Jira UI.`,
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key to update',
            },
            summary: {
              type: 'string',
              description: 'New summary',
            },
            description: {
              type: 'string',
              description: 'New description - see tool description for formatting guide with clickable links',
            },
            status: {
              type: 'string',
              description: 'New status (To Do, In Progress, Done, etc.)',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_add_comment',
        description: `Add a comment to a Jira issue.

IMPORTANT - Comment Formatting:
To create CLICKABLE LINKS to other Jira issues, use this format:
- [PROJ-123|https://your-domain.atlassian.net/browse/PROJ-123] Task description

See jira_update_issue tool description for complete formatting guide.`,
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key',
            },
            comment: {
              type: 'string',
              description: 'Comment text - use format: - [KEY|URL] text for clickable links',
            },
          },
          required: ['issueKey', 'comment'],
        },
      },
      {
        name: 'jira_link_issues',
        description: 'Create a link between two issues. IMPORTANT: When linking multiple issues, use sequential calls (2-3 at a time max) instead of parallel calls to avoid permission prompt issues in Claude Code.',
        inputSchema: {
          type: 'object',
          properties: {
            inwardIssue: {
              type: 'string',
              description: 'Issue key that will be linked from (e.g., TTC-260)',
            },
            outwardIssue: {
              type: 'string',
              description: 'Issue key that will be linked to (e.g., TTC-87)',
            },
            linkType: {
              type: 'string',
              description: 'Link type (Relates, Blocks, Cloners, Duplicate, etc.)',
              default: 'Relates',
            },
          },
          required: ['inwardIssue', 'outwardIssue'],
        },
      },
      {
        name: 'jira_get_project_info',
        description: 'Get project information',
        inputSchema: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'Project key',
              default: JIRA_PROJECT_KEY,
            },
          },
        },
      },
      {
        name: 'jira_delete_issue',
        description: 'Delete a Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key to delete (e.g., TTC-123)',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_create_subtask',
        description: `Create a subtask under a parent issue.

IMPORTANT - Description Formatting:
To create CLICKABLE LINKS to other Jira issues, use this format:
- [PROJ-123|https://your-domain.atlassian.net/browse/PROJ-123] Task description

See jira_update_issue tool description for complete formatting guide.`,
        inputSchema: {
          type: 'object',
          properties: {
            parentKey: {
              type: 'string',
              description: 'Parent issue key (e.g., TTC-261)',
            },
            summary: {
              type: 'string',
              description: 'Subtask summary/title',
            },
            description: {
              type: 'string',
              description: 'Subtask description - use format: - [KEY|URL] text for clickable links',
            },
            priority: {
              type: 'string',
              description: 'Priority (Highest, High, Medium, Low, Lowest)',
              default: 'Medium',
            },
          },
          required: ['parentKey', 'summary', 'description'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'jira_create_issue': {
        const { summary, description, issueType = 'Task', priority = 'Medium', labels = [], storyPoints } = args;

        const issueData = {
          fields: {
            project: { key: JIRA_PROJECT_KEY },
            summary: sanitizeString(summary, 500, 'summary'),
            description: createADFDocument(description),
            issuetype: { name: issueType },
            priority: { name: priority },
            labels,
          },
        };

        if (storyPoints) {
          issueData.fields[STORY_POINTS_FIELD] = storyPoints;
        }

        const response = await jiraApi.post('/issue', issueData);

        return createSuccessResponse({
          success: true,
          key: response.data.key,
          id: response.data.id,
          url: createIssueUrl(response.data.key),
        });
      }

      case 'jira_get_issue': {
        const { issueKey } = args;
        validateIssueKey(issueKey);
        const response = await jiraApi.get(`/issue/${issueKey}`);

        return createSuccessResponse({
          key: response.data.key,
          summary: response.data.fields.summary,
          description: response.data.fields.description,
          status: response.data.fields.status.name,
          assignee: response.data.fields.assignee?.displayName,
          reporter: response.data.fields.reporter?.displayName,
          priority: response.data.fields.priority?.name,
          issueType: response.data.fields.issuetype?.name,
          parent: response.data.fields.parent?.key,
          created: response.data.fields.created,
          updated: response.data.fields.updated,
          url: createIssueUrl(response.data.key),
        });
      }

      case 'jira_search_issues': {
        const { jql, maxResults = 50 } = args;
        validateJQL(jql);
        const response = await jiraApi.get('/search/jql', {
          params: {
            jql,
            maxResults,
            fields: 'summary,status,assignee,priority,created,updated,issuetype,parent',
          },
        });

        return createSuccessResponse({
          total: response.data.total,
          issues: response.data.issues.map(issue => ({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status.name,
            assignee: issue.fields.assignee?.displayName,
            priority: issue.fields.priority?.name,
            issueType: issue.fields.issuetype?.name,
            parent: issue.fields.parent?.key,
            url: createIssueUrl(issue.key),
          })),
        });
      }

      case 'jira_update_issue': {
        const { issueKey, summary, description, status } = args;
        validateIssueKey(issueKey);

        const updateData = { fields: {} };

        if (summary) {
          updateData.fields.summary = sanitizeString(summary, 500, 'summary');
        }
        if (description) {
          updateData.fields.description = createADFDocument(description);
        }

        await jiraApi.put(`/issue/${issueKey}`, updateData);

        if (status) {
          const transitions = await jiraApi.get(`/issue/${issueKey}/transitions`);
          const transition = transitions.data.transitions.find(t => t.name === status);

          if (transition) {
            await jiraApi.post(`/issue/${issueKey}/transitions`, {
              transition: { id: transition.id },
            });
          }
        }

        return createSuccessResponse({
          success: true,
          message: `Issue ${issueKey} updated successfully`,
          url: createIssueUrl(issueKey),
        });
      }

      case 'jira_add_comment': {
        const { issueKey, comment } = args;
        validateIssueKey(issueKey);

        await jiraApi.post(`/issue/${issueKey}/comment`, {
          body: createADFDocument(comment),
        });

        return createSuccessResponse({
          success: true,
          message: `Comment added to ${issueKey}`,
        });
      }

      case 'jira_link_issues': {
        const { inwardIssue, outwardIssue, linkType = 'Relates' } = args;
        validateIssueKey(inwardIssue);
        validateIssueKey(outwardIssue);

        try {
          await jiraApi.post('/issueLink', {
            type: { name: linkType },
            inwardIssue: { key: inwardIssue },
            outwardIssue: { key: outwardIssue },
          });

          return createSuccessResponse({
            success: true,
            message: `Linked ${inwardIssue} to ${outwardIssue} with type "${linkType}"`,
          });
        } catch (linkError) {
          if (linkError.response?.status === 400 &&
              linkError.response?.data?.errorMessages?.includes('link already exists')) {
            return createSuccessResponse({
              success: true,
              message: `Link between ${inwardIssue} and ${outwardIssue} already exists`,
              alreadyLinked: true,
            });
          }
          throw linkError;
        }
      }

      case 'jira_get_project_info': {
        const { projectKey = JIRA_PROJECT_KEY } = args;
        const response = await jiraApi.get(`/project/${projectKey}`);

        return createSuccessResponse({
          key: response.data.key,
          name: response.data.name,
          description: response.data.description,
          lead: response.data.lead?.displayName,
          url: response.data.url,
        });
      }

      case 'jira_delete_issue': {
        const { issueKey } = args;
        validateIssueKey(issueKey);
        await jiraApi.delete(`/issue/${issueKey}`);

        return createSuccessResponse({
          success: true,
          message: `Issue ${issueKey} deleted successfully`,
        });
      }

      case 'jira_create_subtask': {
        const { parentKey, summary, description, priority = 'Medium' } = args;
        validateIssueKey(parentKey);

        const issueData = {
          fields: {
            project: { key: JIRA_PROJECT_KEY },
            summary: sanitizeString(summary, 500, 'summary'),
            description: createADFDocument(description),
            issuetype: { name: 'Subtask' },
            priority: { name: priority },
            parent: { key: parentKey },
          },
        };

        const response = await jiraApi.post('/issue', issueData);

        return createSuccessResponse({
          success: true,
          key: response.data.key,
          id: response.data.id,
          parent: parentKey,
          url: createIssueUrl(response.data.key),
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return handleError(error);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Jira MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
