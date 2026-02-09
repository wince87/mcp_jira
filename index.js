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
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (fallback !== null && fallback !== undefined && fallback !== '') {
    return fallback;
  }
  throw new Error(`Required environment variable ${name} is not set. Please check your .env file.`);
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

function validateProjectKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid project key: must be a string');
  }
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(key)) {
    throw new Error(`Invalid project key format: ${key}. Expected 2-10 uppercase alphanumeric characters`);
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

function validateSafeParam(str, fieldName, maxLength = 100) {
  if (!str || typeof str !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  if (/[\/\\]/.test(str)) {
    throw new Error(`Invalid ${fieldName}: contains unsafe characters`);
  }
  return str.trim();
}

function validateMaxResults(maxResults) {
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error('maxResults must be a positive integer');
  }
  return Math.min(maxResults, 100);
}

function validateStoryPoints(points) {
  if (typeof points !== 'number' || points < 0 || points > 1000) {
    throw new Error('Story points must be a number between 0 and 1000');
  }
  return points;
}

function validateLabels(labels) {
  if (!Array.isArray(labels)) {
    throw new Error('Labels must be an array');
  }
  return labels.map((label, index) => {
    if (typeof label !== 'string') {
      throw new Error(`Label at index ${index} must be a string`);
    }
    if (label.length > 255) {
      throw new Error(`Label at index ${index} exceeds maximum length of 255 characters`);
    }
    return label;
  });
}

const JIRA_URL = getRequiredEnv('JIRA_HOST', process.env.JIRA_URL);
const JIRA_EMAIL = getRequiredEnv('JIRA_EMAIL');
const JIRA_API_TOKEN = getRequiredEnv('JIRA_API_TOKEN');
const JIRA_PROJECT_KEY = validateProjectKey(process.env.JIRA_PROJECT_KEY || 'PROJ');
const STORY_POINTS_FIELD = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';

if (!JIRA_URL.startsWith('https://')) {
  throw new Error('JIRA_HOST must use HTTPS protocol for security');
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

  const jiraErrors = error.response?.data?.errorMessages;
  const jiraFieldErrors = error.response?.data?.errors;

  const errorResponse = {
    error: 'Operation failed',
    message: error.message || 'An unexpected error occurred',
  };

  if (jiraErrors?.length) {
    errorResponse.jiraErrors = jiraErrors;
  }
  if (jiraFieldErrors && Object.keys(jiraFieldErrors).length > 0) {
    errorResponse.fieldErrors = jiraFieldErrors;
  }

  if (isDevelopment) {
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

function parseInlineContent(text) {
  if (!text) return [];

  const parts = [];
  const regex = /\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\[([^\]]+)\|([^\]]+)\]|`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.substring(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      parts.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
    } else if (match[2] !== undefined) {
      parts.push({ type: 'text', text: match[2], marks: [{ type: 'strike' }] });
    } else if (match[3] !== undefined) {
      parts.push({ type: 'text', text: match[3], marks: [{ type: 'em' }] });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'text', text: match[4], marks: [{ type: 'link', attrs: { href: match[5] } }] });
    } else if (match[6] !== undefined) {
      parts.push({ type: 'text', text: match[6], marks: [{ type: 'link', attrs: { href: match[7] } }] });
    } else if (match[8] !== undefined) {
      parts.push({ type: 'text', text: match[8], marks: [{ type: 'code' }] });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.substring(lastIndex) });
  }

  if (parts.length > 0) return parts;
  return text ? [{ type: 'text', text }] : [];
}

function addBulletItem(nodes, content) {
  const listItem = {
    type: 'listItem',
    content: [{ type: 'paragraph', content }]
  };
  const lastNode = nodes[nodes.length - 1];
  if (lastNode && lastNode.type === 'bulletList') {
    lastNode.content.push(listItem);
  } else {
    nodes.push({ type: 'bulletList', content: [listItem] });
  }
}

function addOrderedItem(nodes, content) {
  const listItem = {
    type: 'listItem',
    content: [{ type: 'paragraph', content }]
  };
  const lastNode = nodes[nodes.length - 1];
  if (lastNode && lastNode.type === 'orderedList') {
    lastNode.content.push(listItem);
  } else {
    nodes.push({ type: 'orderedList', content: [listItem] });
  }
}

function createADFDocument(content) {
  if (!content || typeof content !== 'string') {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [] }]
    };
  }

  const nodes = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    const jiraHeading = line.match(/^h([1-6])\.\s+(.+)/);
    const mdHeading = line.match(/^(#{1,6})\s+(.+)/);

    if (jiraHeading) {
      nodes.push({
        type: 'heading',
        attrs: { level: parseInt(jiraHeading[1]) },
        content: parseInlineContent(jiraHeading[2])
      });
    } else if (mdHeading) {
      nodes.push({
        type: 'heading',
        attrs: { level: mdHeading[1].length },
        content: parseInlineContent(mdHeading[2])
      });
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      addBulletItem(nodes, parseInlineContent(line.substring(2)));
    } else if (/^\d+\.\s+/.test(line)) {
      addOrderedItem(nodes, parseInlineContent(line.replace(/^\d+\.\s+/, '')));
    } else if (line.startsWith('> ')) {
      const text = line.substring(2);
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === 'blockquote') {
        lastNode.content.push({
          type: 'paragraph',
          content: parseInlineContent(text)
        });
      } else {
        nodes.push({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: parseInlineContent(text) }]
        });
      }
    } else if (line === '----' || line === '---') {
      nodes.push({ type: 'rule' });
    } else if (line === '```' || line.startsWith('```')) {
      const lang = line.length > 3 ? line.substring(3).trim() : null;
      const codeLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      const codeText = codeLines.join('\n');
      const codeBlock = { type: 'codeBlock' };
      if (codeText) {
        codeBlock.content = [{ type: 'text', text: codeText }];
      }
      if (lang) {
        codeBlock.attrs = { language: lang };
      }
      nodes.push(codeBlock);
    } else {
      nodes.push({
        type: 'paragraph',
        content: parseInlineContent(line)
      });
    }
  }

  if (nodes.length === 0) {
    nodes.push({ type: 'paragraph', content: [] });
  }

  return {
    type: 'doc',
    version: 1,
    content: nodes
  };
}

function inlineNodesToText(nodes) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => {
    if (node.type === 'text') {
      let text = node.text || '';
      if (node.marks) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'strong': text = `**${text}**`; break;
            case 'em': text = `*${text}*`; break;
            case 'strike': text = `~~${text}~~`; break;
            case 'code': text = `\`${text}\``; break;
            case 'link': text = `[${text}](${mark.attrs?.href || ''})`; break;
          }
        }
      }
      return text;
    }
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return `@${node.attrs?.text || node.attrs?.id || ''}`;
    if (node.type === 'inlineCard') return node.attrs?.url || '';
    if (node.type === 'emoji') return node.attrs?.shortName || '';
    return '';
  }).join('');
}

function blockNodeToText(node) {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph':
      return inlineNodesToText(node.content);
    case 'heading': {
      const level = node.attrs?.level || 1;
      return '#'.repeat(level) + ' ' + inlineNodesToText(node.content);
    }
    case 'bulletList':
      return (node.content || []).map(item =>
        '- ' + (item.content || []).map(c => blockNodeToText(c)).join('\n')
      ).join('\n');
    case 'orderedList':
      return (node.content || []).map((item, i) =>
        `${i + 1}. ` + (item.content || []).map(c => blockNodeToText(c)).join('\n')
      ).join('\n');
    case 'blockquote':
      return (node.content || []).map(c => '> ' + blockNodeToText(c)).join('\n');
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = inlineNodesToText(node.content);
      return '```' + lang + '\n' + code + '\n```';
    }
    case 'rule':
      return '---';
    case 'table':
      return (node.content || []).map(row =>
        '| ' + (row.content || []).map(cell =>
          (cell.content || []).map(c => blockNodeToText(c)).join(' ')
        ).join(' | ') + ' |'
      ).join('\n');
    case 'mediaSingle':
    case 'mediaGroup':
      return '[media]';
    default:
      return inlineNodesToText(node.content);
  }
}

function adfToText(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return typeof doc === 'string' ? doc : '';
  }
  return doc.content.map(node => blockNodeToText(node)).join('\n\n');
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
            text: `This MCP server automatically converts Markdown to Atlassian Document Format (ADF).

Use standard Markdown:

Headings: # H1, ## H2, ### H3, #### H4, ##### H5, ###### H6
Bold: **bold text**
Italic: *italic text*
Strikethrough: ~~deleted text~~
Inline code: \`code\`
Links: [text](https://example.com)
Bullet lists: - item
Numbered lists: 1. item
Blockquotes: > text
Code blocks: \`\`\`language ... \`\`\`
Horizontal rule: ---

When referencing Jira issues, always use clickable links:
[PROJ-123](https://your-domain.atlassian.net/browse/PROJ-123)`,
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
        description: 'Create a new Jira issue. Description supports standard Markdown (headings, **bold**, [links](url), lists, code blocks). Automatically converted to ADF.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Issue summary/title',
            },
            description: {
              type: 'string',
              description: 'Issue description in Markdown. Use [KEY](url) for clickable issue links.',
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
              description: 'Story points estimate (0-1000)',
            },
            projectKey: {
              type: 'string',
              description: 'Project key (defaults to configured JIRA_PROJECT_KEY)',
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
              description: 'Maximum number of results (1-100)',
              default: 50,
            },
          },
          required: ['jql'],
        },
      },
      {
        name: 'jira_update_issue',
        description: 'Update a Jira issue. Description supports standard Markdown (headings, **bold**, [links](url), lists, code blocks). Automatically converted to ADF.',
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
              description: 'New description in Markdown. Use [KEY](url) for clickable issue links.',
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
        description: 'Add a comment to a Jira issue. Supports standard Markdown, automatically converted to ADF.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key',
            },
            comment: {
              type: 'string',
              description: 'Comment text in Markdown.',
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
        description: 'Create a subtask under a parent issue. Description supports standard Markdown, automatically converted to ADF.',
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
              description: 'Subtask description in Markdown. Use [KEY](url) for clickable issue links.',
            },
            priority: {
              type: 'string',
              description: 'Priority (Highest, High, Medium, Low, Lowest)',
              default: 'Medium',
            },
            projectKey: {
              type: 'string',
              description: 'Project key (defaults to configured JIRA_PROJECT_KEY)',
            },
          },
          required: ['parentKey', 'summary', 'description'],
        },
      },
      {
        name: 'jira_assign_issue',
        description: 'Assign or unassign a user to a Jira issue. Pass null accountId to unassign.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key (e.g., TTC-123)',
            },
            accountId: {
              type: ['string', 'null'],
              description: 'Atlassian account ID of the assignee, or null to unassign',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_list_transitions',
        description: 'Get available status transitions for a Jira issue.',
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
        name: 'jira_add_worklog',
        description: 'Add a worklog entry (time tracking) to a Jira issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key (e.g., TTC-123)',
            },
            timeSpent: {
              type: 'string',
              description: 'Time spent in Jira format (e.g., "2h 30m", "1d", "45m")',
            },
            comment: {
              type: 'string',
              description: 'Worklog comment in Markdown.',
            },
            started: {
              type: 'string',
              description: 'Start date/time in ISO 8601 format (e.g., "2024-01-15T09:00:00.000+0000"). Defaults to now.',
            },
          },
          required: ['issueKey', 'timeSpent'],
        },
      },
      {
        name: 'jira_get_comments',
        description: 'Get comments from a Jira issue.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Issue key (e.g., TTC-123)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of comments (1-100)',
              default: 50,
            },
            orderBy: {
              type: 'string',
              description: 'Order by created date: "created" (oldest first) or "-created" (newest first)',
              default: '-created',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_get_worklogs',
        description: 'Get worklog entries from a Jira issue.',
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
        name: 'jira_list_projects',
        description: 'List all accessible Jira projects.',
        inputSchema: {
          type: 'object',
          properties: {
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (1-100)',
              default: 50,
            },
            query: {
              type: 'string',
              description: 'Filter projects by name (partial match)',
            },
          },
        },
      },
      {
        name: 'jira_get_project_components',
        description: 'Get components of a Jira project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'Project key (defaults to configured JIRA_PROJECT_KEY)',
            },
          },
        },
      },
      {
        name: 'jira_get_project_versions',
        description: 'Get versions (releases) of a Jira project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'Project key (defaults to configured JIRA_PROJECT_KEY)',
            },
          },
        },
      },
      {
        name: 'jira_get_fields',
        description: 'Get all available Jira fields. Useful for finding custom field IDs.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'jira_get_issue_types',
        description: 'Get all available issue types for a project.',
        inputSchema: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'Project key (defaults to configured JIRA_PROJECT_KEY)',
            },
          },
        },
      },
      {
        name: 'jira_get_priorities',
        description: 'Get all available issue priorities.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'jira_get_link_types',
        description: 'Get all available issue link types.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'jira_search_users',
        description: 'Search for Jira users by name or email. Returns accountId needed for jira_assign_issue.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (matches display name and email prefix)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results (1-100)',
              default: 10,
            },
          },
          required: ['query'],
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
        const projectKey = args.projectKey ? validateProjectKey(args.projectKey) : JIRA_PROJECT_KEY;

        validateSafeParam(issueType, 'issueType');
        validateSafeParam(priority, 'priority');
        const validatedLabels = validateLabels(labels);

        const issueData = {
          fields: {
            project: { key: projectKey },
            summary: sanitizeString(summary, 500, 'summary'),
            description: createADFDocument(description),
            issuetype: { name: issueType },
            priority: { name: priority },
            labels: validatedLabels,
          },
        };

        if (storyPoints !== undefined && storyPoints !== null) {
          issueData.fields[STORY_POINTS_FIELD] = validateStoryPoints(storyPoints);
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
        const f = response.data.fields;

        return createSuccessResponse({
          key: response.data.key,
          summary: f.summary,
          description: adfToText(f.description),
          status: f.status?.name,
          assignee: f.assignee ? { displayName: f.assignee.displayName, accountId: f.assignee.accountId } : null,
          reporter: f.reporter?.displayName,
          priority: f.priority?.name,
          issueType: f.issuetype?.name,
          labels: f.labels || [],
          storyPoints: f[STORY_POINTS_FIELD],
          parent: f.parent?.key,
          created: f.created,
          updated: f.updated,
          url: createIssueUrl(response.data.key),
        });
      }

      case 'jira_search_issues': {
        const { jql, maxResults = 50 } = args;
        validateJQL(jql);
        const validatedMaxResults = validateMaxResults(maxResults);

        const response = await jiraApi.post('/search', {
          jql,
          maxResults: validatedMaxResults,
          fields: ['summary', 'status', 'assignee', 'priority', 'created', 'updated', 'issuetype', 'parent', 'labels'],
        });

        return createSuccessResponse({
          total: response.data.total,
          issues: response.data.issues.map(issue => ({
            key: issue.key,
            summary: issue.fields.summary,
            status: issue.fields.status?.name,
            assignee: issue.fields.assignee ? { displayName: issue.fields.assignee.displayName, accountId: issue.fields.assignee.accountId } : null,
            priority: issue.fields.priority?.name,
            issueType: issue.fields.issuetype?.name,
            labels: issue.fields.labels || [],
            parent: issue.fields.parent?.key,
            url: createIssueUrl(issue.key),
          })),
        });
      }

      case 'jira_update_issue': {
        const { issueKey, summary, description, status } = args;
        validateIssueKey(issueKey);

        const updateData = { fields: {} };
        let hasFieldUpdates = false;

        if (summary) {
          updateData.fields.summary = sanitizeString(summary, 500, 'summary');
          hasFieldUpdates = true;
        }
        if (description) {
          updateData.fields.description = createADFDocument(description);
          hasFieldUpdates = true;
        }

        if (hasFieldUpdates) {
          await jiraApi.put(`/issue/${issueKey}`, updateData);
        }

        const warnings = [];

        if (status) {
          const transitions = await jiraApi.get(`/issue/${issueKey}/transitions`);
          const transition = transitions.data.transitions.find(t => t.name === status);

          if (transition) {
            await jiraApi.post(`/issue/${issueKey}/transitions`, {
              transition: { id: transition.id },
            });
          } else {
            const available = transitions.data.transitions.map(t => t.name).join(', ');
            warnings.push(`Transition "${status}" not found. Available transitions: ${available}`);
          }
        }

        if (!hasFieldUpdates && !status) {
          return createSuccessResponse({
            success: false,
            message: `No updates provided for ${issueKey}`,
          });
        }

        const result = {
          success: warnings.length === 0,
          message: `Issue ${issueKey} updated${warnings.length > 0 ? ' with warnings' : ' successfully'}`,
          url: createIssueUrl(issueKey),
        };

        if (warnings.length > 0) {
          result.warnings = warnings;
        }

        return createSuccessResponse(result);
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
        validateSafeParam(linkType, 'linkType');

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
        validateProjectKey(projectKey);
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
        validateSafeParam(priority, 'priority');
        const projectKey = args.projectKey ? validateProjectKey(args.projectKey) : JIRA_PROJECT_KEY;

        const issueData = {
          fields: {
            project: { key: projectKey },
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

      case 'jira_assign_issue': {
        const { issueKey, accountId } = args;
        validateIssueKey(issueKey);

        await jiraApi.put(`/issue/${issueKey}/assignee`, {
          accountId: accountId !== undefined ? accountId : null,
        });

        return createSuccessResponse({
          success: true,
          message: accountId
            ? `Issue ${issueKey} assigned to ${accountId}`
            : `Issue ${issueKey} unassigned`,
          url: createIssueUrl(issueKey),
        });
      }

      case 'jira_list_transitions': {
        const { issueKey } = args;
        validateIssueKey(issueKey);

        const response = await jiraApi.get(`/issue/${issueKey}/transitions`);

        return createSuccessResponse({
          issueKey,
          transitions: response.data.transitions.map(t => ({
            id: t.id,
            name: t.name,
            to: {
              id: t.to.id,
              name: t.to.name,
              category: t.to.statusCategory?.name,
            },
          })),
        });
      }

      case 'jira_add_worklog': {
        const { issueKey, timeSpent, comment, started } = args;
        validateIssueKey(issueKey);
        sanitizeString(timeSpent, 50, 'timeSpent');

        const worklogData = { timeSpent };
        if (comment) {
          worklogData.comment = createADFDocument(comment);
        }
        if (started) {
          worklogData.started = started;
        }

        const response = await jiraApi.post(`/issue/${issueKey}/worklog`, worklogData);

        return createSuccessResponse({
          success: true,
          id: response.data.id,
          issueKey,
          timeSpent: response.data.timeSpent,
          author: response.data.author?.displayName,
        });
      }

      case 'jira_get_comments': {
        const { issueKey, maxResults = 50, orderBy = '-created' } = args;
        validateIssueKey(issueKey);
        const validatedMaxResults = validateMaxResults(maxResults);

        const response = await jiraApi.get(`/issue/${issueKey}/comment`, {
          params: { maxResults: validatedMaxResults, orderBy },
        });

        return createSuccessResponse({
          issueKey,
          total: response.data.total,
          comments: response.data.comments.map(c => ({
            id: c.id,
            author: c.author?.displayName,
            body: adfToText(c.body),
            created: c.created,
            updated: c.updated,
          })),
        });
      }

      case 'jira_get_worklogs': {
        const { issueKey } = args;
        validateIssueKey(issueKey);

        const response = await jiraApi.get(`/issue/${issueKey}/worklog`);

        return createSuccessResponse({
          issueKey,
          total: response.data.total,
          worklogs: response.data.worklogs.map(w => ({
            id: w.id,
            author: w.author?.displayName,
            timeSpent: w.timeSpent,
            timeSpentSeconds: w.timeSpentSeconds,
            started: w.started,
            comment: adfToText(w.comment),
          })),
        });
      }

      case 'jira_list_projects': {
        const { maxResults = 50, query } = args;
        const validatedMaxResults = validateMaxResults(maxResults);

        const params = { maxResults: validatedMaxResults };
        if (query) {
          params.query = sanitizeString(query, 200, 'query');
        }

        const response = await jiraApi.get('/project/search', { params });

        return createSuccessResponse({
          total: response.data.total,
          projects: response.data.values.map(p => ({
            key: p.key,
            name: p.name,
            projectTypeKey: p.projectTypeKey,
            style: p.style,
            lead: p.lead?.displayName,
          })),
        });
      }

      case 'jira_get_project_components': {
        const projectKey = args.projectKey ? validateProjectKey(args.projectKey) : JIRA_PROJECT_KEY;

        const response = await jiraApi.get(`/project/${projectKey}/components`);

        return createSuccessResponse({
          projectKey,
          components: response.data.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            lead: c.lead?.displayName,
            assigneeType: c.assigneeType,
          })),
        });
      }

      case 'jira_get_project_versions': {
        const projectKey = args.projectKey ? validateProjectKey(args.projectKey) : JIRA_PROJECT_KEY;

        const response = await jiraApi.get(`/project/${projectKey}/versions`);

        return createSuccessResponse({
          projectKey,
          versions: response.data.map(v => ({
            id: v.id,
            name: v.name,
            description: v.description,
            released: v.released,
            archived: v.archived,
            releaseDate: v.releaseDate,
            startDate: v.startDate,
          })),
        });
      }

      case 'jira_get_fields': {
        const response = await jiraApi.get('/field');

        return createSuccessResponse({
          fields: response.data.map(f => ({
            id: f.id,
            name: f.name,
            custom: f.custom,
            schema: f.schema,
          })),
        });
      }

      case 'jira_get_issue_types': {
        const projectKey = args.projectKey ? validateProjectKey(args.projectKey) : JIRA_PROJECT_KEY;

        const response = await jiraApi.get(`/issue/createmeta/${projectKey}/issuetypes`);

        return createSuccessResponse({
          projectKey,
          issueTypes: response.data.issueTypes.map(t => ({
            id: t.id,
            name: t.name,
            subtask: t.subtask,
            description: t.description,
          })),
        });
      }

      case 'jira_get_priorities': {
        const response = await jiraApi.get('/priority');

        return createSuccessResponse({
          priorities: response.data.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            iconUrl: p.iconUrl,
          })),
        });
      }

      case 'jira_get_link_types': {
        const response = await jiraApi.get('/issueLinkType');

        return createSuccessResponse({
          linkTypes: response.data.issueLinkTypes.map(lt => ({
            id: lt.id,
            name: lt.name,
            inward: lt.inward,
            outward: lt.outward,
          })),
        });
      }

      case 'jira_search_users': {
        const { query, maxResults = 10 } = args;
        sanitizeString(query, 200, 'query');
        const validatedMaxResults = validateMaxResults(maxResults);

        const response = await jiraApi.get('/user/search', {
          params: { query, maxResults: validatedMaxResults },
        });

        return createSuccessResponse({
          users: response.data.map(u => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress,
            active: u.active,
            accountType: u.accountType,
          })),
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
