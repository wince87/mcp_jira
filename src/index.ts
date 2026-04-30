#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { type AxiosInstance, type AxiosError, type CreateAxiosDefaults } from 'axios';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, basename } from 'path';

interface ADFMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface ADFNode {
  type: string;
  text?: string;
  marks?: ADFMark[];
  attrs?: Record<string, unknown>;
  content?: ADFNode[];
}

interface ADFDocument {
  type: 'doc';
  version: 1;
  content: ADFNode[];
}

interface ToolResponse {
  [key: string]: unknown;
  content: { type: string; text: string }[];
  isError?: boolean;
}

interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  accountType?: string;
}

interface JiraStatusCategory {
  key?: string;
  name?: string;
}

interface JiraStatus {
  name?: string;
  statusCategory?: JiraStatusCategory;
}

interface JiraAttachment {
  id?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: JiraUser;
  content?: string;
}

interface JiraIssueFields {
  summary?: string;
  status?: JiraStatus;
  assignee?: JiraUser | null;
  reporter?: JiraUser;
  priority?: { name?: string };
  issuetype?: { name?: string; subtask?: boolean };
  parent?: { key?: string };
  project?: { key?: string };
  labels?: string[];
  created?: string;
  updated?: string;
  description?: unknown;
  attachment?: JiraAttachment[];
  [key: string]: unknown;
}

interface JiraIssue {
  id?: string;
  key: string;
  fields: JiraIssueFields;
}

interface JiraComment {
  id?: string;
  author?: JiraUser;
  body?: unknown;
  created?: string;
  updated?: string;
}

interface JiraWorklog {
  id?: string;
  author?: JiraUser;
  timeSpent?: string;
  timeSpentSeconds?: number;
  started?: string;
  comment?: unknown;
}

interface JiraTransition {
  id: string;
  name: string;
  to: { id?: string; name?: string; statusCategory?: JiraStatusCategory };
}

interface JiraChangelogItem {
  field?: string;
  fromString?: string;
  toString?: string;
}

interface JiraChangelogHistory {
  id?: string;
  author?: JiraUser;
  created?: string;
  items?: JiraChangelogItem[];
}

interface JiraProject {
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  lead?: JiraUser;
  url?: string;
  projectTypeKey?: string;
  style?: string;
}

interface JiraIssueType {
  id?: string;
  name?: string;
  subtask?: boolean;
  description?: string;
}

interface JiraPriority {
  id?: string;
  name?: string;
  description?: string;
  iconUrl?: string;
}

interface JiraLinkType {
  id?: string;
  name?: string;
  inward?: string;
  outward?: string;
}

interface JiraField {
  id?: string;
  name?: string;
  custom?: boolean;
  schema?: { type?: string; custom?: string };
}

interface JiraComponent {
  id?: string;
  name?: string;
  description?: string;
  lead?: JiraUser;
  assigneeType?: string;
}

interface JiraVersion {
  id?: string;
  name?: string;
  description?: string;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string;
  startDate?: string;
}

interface JiraBoard {
  id?: number;
  name?: string;
  type?: string;
  location?: { projectKey?: string; projectName?: string };
}

interface JiraSprint {
  id?: number;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

interface BulkIssueInput {
  summary?: unknown;
  description?: unknown;
  issueType?: unknown;
  priority?: unknown;
  labels?: unknown;
  storyPoints?: unknown;
}

interface JiraIssuePayload {
  fields: Record<string, unknown>;
}

function getRequiredEnv(name: string, fallback: string | null = null): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  if (fallback !== null && fallback !== undefined && fallback !== '') {
    return fallback;
  }
  throw new Error(`Required environment variable ${name} is not set. Set it via your MCP client config or shell environment.`);
}

function validateIssueKey(key: unknown): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid issue key: must be a string');
  }
  if (!/^[A-Z]+-\d+$/.test(key)) {
    throw new Error(`Invalid issue key format: ${key}. Expected format: PROJECT-123`);
  }
  return key;
}

function validateProjectKey(key: unknown): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid project key: must be a string');
  }
  if (!/^[A-Z][A-Z0-9_]{0,9}$/.test(key)) {
    throw new Error(`Invalid project key format: ${key}. Expected 1-10 uppercase alphanumeric characters`);
  }
  return key;
}

function validateJQL(jql: unknown): string {
  if (!jql || typeof jql !== 'string') {
    throw new Error('Invalid JQL query: must be a string');
  }
  if (jql.length > 5000) {
    throw new Error('JQL query too long: maximum 5000 characters');
  }
  return jql;
}

function sanitizeString(str: unknown, maxLength: number = 1000, fieldName: string = 'input'): string {
  if (!str || typeof str !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  return str.trim();
}

function validateSafeParam(str: unknown, fieldName: string, maxLength: number = 100): string {
  const value = sanitizeString(str, maxLength, fieldName);
  if (/[\/\\]/.test(value)) {
    throw new Error(`Invalid ${fieldName}: contains unsafe characters`);
  }
  return value;
}

function validateMaxResults(maxResults: unknown): number {
  if (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error('maxResults must be a positive integer');
  }
  return Math.min(maxResults, 100);
}

function validateStoryPoints(points: unknown): number {
  if (typeof points !== 'number' || points < 0 || points > 1000) {
    throw new Error('Story points must be a number between 0 and 1000');
  }
  return points;
}

function validateLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    throw new Error('Labels must be an array');
  }
  return labels.map((label: unknown, index: number) => {
    if (typeof label !== 'string') {
      throw new Error(`Label at index ${index} must be a string`);
    }
    if (label.length > 255) {
      throw new Error(`Label at index ${index} exceeds maximum length of 255 characters`);
    }
    return label;
  });
}

function validateAccountId(id: unknown): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid accountId: must be a string');
  }
  if (!/^[a-zA-Z0-9:._-]{1,128}$/.test(id)) {
    throw new Error('Invalid accountId: must be 1-128 alphanumeric characters (with :._-)');
  }
  return id;
}

function validateISO8601(value: unknown, fieldName: string = 'datetime'): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be ISO 8601 with timezone offset (e.g., "2024-01-15T09:00:00.000+0000")`);
  }
  return value;
}

const ALLOWED_ATTACHMENT_BASES: string[] = [process.cwd(), process.env.HOME ?? ''].filter((b): b is string => b.length > 0);

function validateAttachmentPath(filePath: string): string {
  const absolutePath = resolve(filePath);
  const withinAllowed = ALLOWED_ATTACHMENT_BASES.some(base => absolutePath === base || absolutePath.startsWith(base + '/'));
  if (!withinAllowed) {
    throw new Error('filePath must be within the current working directory or user home directory');
  }
  return absolutePath;
}

const SERVER_VERSION = '2.7.0';

const JIRA_URL: string = getRequiredEnv('JIRA_HOST', process.env.JIRA_URL ?? null);
const JIRA_EMAIL: string = getRequiredEnv('JIRA_EMAIL');
const JIRA_API_TOKEN: string = getRequiredEnv('JIRA_API_TOKEN');
const JIRA_PROJECT_KEY: string = validateProjectKey(process.env.JIRA_PROJECT_KEY || 'PROJ');
const STORY_POINTS_FIELD: string = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';

if (!JIRA_URL.startsWith('https://')) {
  throw new Error('JIRA_HOST must use HTTPS protocol for security');
}

function createSuccessResponse(data: unknown): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function createIssueUrl(issueKey: string): string {
  return `${JIRA_URL}/browse/${issueKey}`;
}

function resolveProjectKey(a: Record<string, unknown>): string {
  return a?.projectKey ? validateProjectKey(a.projectKey) : JIRA_PROJECT_KEY;
}

function handleError(error: unknown): ToolResponse {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const axiosError = error as AxiosError<{ errorMessages?: string[]; errors?: Record<string, string> }>;

  const jiraErrors = axiosError.response?.data?.errorMessages;
  const jiraFieldErrors = axiosError.response?.data?.errors;

  const errorResponse: Record<string, unknown> = {
    error: 'Operation failed',
    message: (error instanceof Error ? error.message : undefined) || 'An unexpected error occurred',
  };

  if (jiraErrors?.length) {
    errorResponse.jiraErrors = jiraErrors;
  }
  if (jiraFieldErrors && Object.keys(jiraFieldErrors).length > 0) {
    errorResponse.fieldErrors = jiraFieldErrors;
  }

  if (isDevelopment && error instanceof Error) {
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

const axiosAuthConfig: CreateAxiosDefaults = {
  auth: {
    username: JIRA_EMAIL,
    password: JIRA_API_TOKEN,
  },
  timeout: 30000,
};

const jiraApi: AxiosInstance = axios.create({
  baseURL: `${JIRA_URL}/rest/api/3`,
  headers: { 'Content-Type': 'application/json' },
  ...axiosAuthConfig,
});

const agileApi: AxiosInstance = axios.create({
  baseURL: `${JIRA_URL}/rest/agile/1.0`,
  headers: { 'Content-Type': 'application/json' },
  ...axiosAuthConfig,
});

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

function parseInlineContent(text: string): ADFNode[] {
  if (!text) return [];

  const parts: ADFNode[] = [];
  const regex = /\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|\[([^\]]+)\|([^\]]+)\]|`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

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

  return parts;
}

function addListItem(nodes: ADFNode[], content: ADFNode[], listType: 'bulletList' | 'orderedList'): void {
  const listItem: ADFNode = {
    type: 'listItem',
    content: [{ type: 'paragraph', content }]
  };
  const lastNode = nodes[nodes.length - 1];
  if (lastNode && lastNode.type === listType) {
    lastNode.content!.push(listItem);
  } else {
    nodes.push({ type: listType, content: [listItem] });
  }
}

function createADFDocument(content: unknown): ADFDocument {
  if (!content || typeof content !== 'string') {
    return {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [] }]
    };
  }

  const nodes: ADFNode[] = [];
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
      addListItem(nodes, parseInlineContent(line.substring(2)), 'bulletList');
    } else if (/^\d+\.\s+/.test(line)) {
      addListItem(nodes, parseInlineContent(line.replace(/^\d+\.\s+/, '')), 'orderedList');
    } else if (line.startsWith('> ')) {
      const text = line.substring(2);
      const lastNode = nodes[nodes.length - 1];
      if (lastNode && lastNode.type === 'blockquote') {
        lastNode.content!.push({
          type: 'paragraph',
          content: parseInlineContent(text)
        });
      } else {
        nodes.push({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: parseInlineContent(text) }]
        });
      }
    } else if (line.startsWith('|') && line.endsWith('|')) {
      const parseTableRow = (row: string, cellType: string): ADFNode => ({
        type: 'tableRow',
        content: row.slice(1, -1).split('|').map(cell => ({
          type: cellType,
          content: [{ type: 'paragraph', content: parseInlineContent(cell.trim()) }],
        })),
      });

      const isHeader = i + 1 < lines.length && /^\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|$/.test(lines[i + 1].trim());
      const tableRows: ADFNode[] = [];

      if (isHeader) {
        tableRows.push(parseTableRow(line, 'tableHeader'));
        i += 2;
      }

      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(parseTableRow(lines[i].trim(), 'tableCell'));
        i++;
      }

      if (!isHeader && tableRows.length === 0) {
        tableRows.push(parseTableRow(line, 'tableCell'));
      }

      i--;
      nodes.push({ type: 'table', attrs: { layout: 'default' }, content: tableRows });
    } else if (line === '----' || line === '---') {
      nodes.push({ type: 'rule' });
    } else if (line === '```' || line.startsWith('```')) {
      const lang = line.length > 3 ? line.substring(3).trim() : null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      const codeText = codeLines.join('\n');
      const codeBlock: ADFNode = { type: 'codeBlock' };
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

function inlineNodesToText(nodes: ADFNode[] | undefined): string {
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
            case 'link': text = `[${text}](${(mark.attrs?.href as string) || ''})`; break;
          }
        }
      }
      return text;
    }
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return `@${(node.attrs?.text as string) || (node.attrs?.id as string) || ''}`;
    if (node.type === 'inlineCard') return (node.attrs?.url as string) || '';
    if (node.type === 'emoji') return (node.attrs?.shortName as string) || '';
    return '';
  }).join('');
}

function blockNodeToText(node: ADFNode): string {
  if (!node) return '';
  switch (node.type) {
    case 'paragraph':
      return inlineNodesToText(node.content);
    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
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
      const lang = (node.attrs?.language as string) || '';
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

function adfToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object' || (doc as ADFDocument).type !== 'doc' || !Array.isArray((doc as ADFDocument).content)) {
    return typeof doc === 'string' ? doc : '';
  }
  return (doc as ADFDocument).content.map(node => blockNodeToText(node)).join('\n\n');
}

interface PromptDef {
  description: string;
  text: string;
}

const PROMPTS: Record<string, PromptDef> = {
  'jira-formatting-guide': {
    description: 'Markdown formatting rules for Jira descriptions and comments (auto-converted to ADF).',
    text: `This MCP server automatically converts Markdown to Atlassian Document Format (ADF).

Use standard Markdown:

Headings: # H1, ## H2, ### H3, #### H4, ##### H5, ###### H6
Bold: **bold text**
Italic: *italic text*
Strikethrough: ~~deleted text~~
Inline code: \`code\`
Links: [text](url)
Bullet lists: - item
Numbered lists: 1. item
Blockquotes: > text
Code blocks: \`\`\`language ... \`\`\`
Horizontal rule: ---

When referencing Jira issues, always use clickable links:
[PROJ-123](<browse-url>)`,
  },
  'jira-bug-triage': {
    description: 'Workflow guide for triaging open bugs (assign, prioritize, comment).',
    text: `Workflow for triaging open bugs in Jira.

Step 1 - Find untriaged bugs:
Call jira_search_issues with JQL like:
  project = "<KEY>" AND issuetype = Bug AND status = "To Do" AND assignee is EMPTY

Step 2 - For each bug, gather context:
- jira_get_issue to read description and recent comments
- jira_get_changelog if history matters
- jira_search_issues for similar/duplicate bugs (by keywords)

Step 3 - Set priority (use jira_update_issue with priority field):
- Highest: production down, data loss, security
- High: major feature broken, many users affected
- Medium: broken for some users, workaround exists
- Low: edge case, cosmetic
- Lowest: minor polish

Step 4 - Assign:
- Find owner: jira_search_users by component/team
- jira_assign_issue with accountId

Step 5 - Record rationale:
- jira_add_comment explaining priority and assignment

Never guess accountId or priority enum values - call jira_search_users / jira_get_priorities first if unsure.`,
  },
  'jira-sprint-summary': {
    description: 'Generate a status report for the current active sprint.',
    text: `Generate a status report for the active sprint.

Step 1 - Find the active sprint:
- jira_list_boards (pick the right project board)
- jira_list_sprints with state="active"
- If multiple, ask the user which one

Step 2 - Get sprint contents:
- jira_get_sprint (returns all issues with status, assignee, story points)

Step 3 - Classify issues into:
- Done (status category = done)
- In Progress (status category = indeterminate)
- To Do (status category = new)
- Blocked (label "blocked", or "is blocked by" link present)

Step 4 - For blocked issues, resolve the blocker:
- Inspect issue links via jira_get_issue
- Note who/what blocks each blocked item

Step 5 - Compose Markdown report:
## <Sprint name> - <dates>
- Completed: X / Y issues, A / B story points
- In Progress: list with assignee
- Blocked: list with blocker reason
- Risks: items unassigned or untouched for > 3 days

Always include clickable links [PROJ-XXX](<url>) for every referenced issue.`,
  },
  'jira-epic-breakdown': {
    description: 'Break a product idea into a new epic with child stories and subtasks.',
    text: `Break a product idea into an epic with structured child work.

Step 1 - Create the epic:
- jira_create_epic with summary and description (user intent, success criteria)

Step 2 - Identify major pieces of work (stories):
Typical slices: API / DB / UI / tests / docs / ops
For each piece call jira_create_issue with:
  issueType: "Story"
  parent: <epic_key>
  summary: <verb-first, outcome-focused>
  description: acceptance criteria as markdown checklist

Step 3 - Add subtasks only where the story is > 1 day of work:
- jira_create_subtask with concrete implementation steps (typed, numbered)

Step 4 - Map dependencies:
- jira_link_issues with linkType "Blocks" or "Is blocked by"
- linkType list via jira_get_link_types (run once if unsure)

Step 5 - Return tree summary:
EPIC-<n>: <summary>
  STORY-<n>: <summary> [points]
    SUBTASK-<n>: ...
  ...

Never invent issueType or linkType names; fetch them if uncertain.`,
  },
  'jira-standup-prep': {
    description: 'Prepare standup notes (Yesterday / Today / Blockers) for the authenticated user.',
    text: `Prepare standup notes for the current user.

Step 1 - Identify "me":
- jira_get_myself -> use accountId

Step 2 - Yesterday (what I finished or worked on):
- jira_get_user_issues for accountId
  Filter client-side by updated within last ~24h
- For status transitions, use jira_get_changelog on key issues
- List completed and in-progress work

Step 3 - Today (what I plan to do):
- From same list, pick status = "In Progress" or next "To Do" by priority
- If nothing in progress, pick highest-priority unstarted
- Call out items with due date today/tomorrow

Step 4 - Blockers:
- Flag any issue with label "blocked" or with "is blocked by" incoming link
- For each blocker, name the blocking issue (and owner if assigned)

Step 5 - Format:
**Yesterday**
- [KEY-1](<url>) - summary (status changes)
- ...

**Today**
- [KEY-2](<url>) - summary (plan)

**Blockers**
- [KEY-3](<url>) blocked by [KEY-99](<url>) (<owner>) - reason

Keep it under ~10 bullets per section. Prefer outcomes over activity.`,
  },
  'jira-dependency-map': {
    description: 'Trace all blockers (direct and transitive) for an issue or epic.',
    text: `Map out what is blocking a target issue or epic, recursively.

Step 1 - Load the starting point:
- jira_get_issue for the target key
- Record its status, assignee, summary

Step 2 - Find direct blockers (issues that block the target):
- jira_get_issue returns issuelinks
- Filter for linkType where inward = "is blocked by" or "Blocks" (outward direction on the current issue)
- Collect the blocker keys

Step 3 - Recurse (max depth 3):
- For each blocker, run Step 1 + 2
- Track visited keys to avoid cycles
- Stop descending once status category = done

Step 4 - Surface risks:
- Blockers that are themselves blocked (chain length >= 2)
- Blockers unassigned
- Blockers without activity (no jira_get_changelog entries) in the last 14 days
- Blockers in a different project (cross-team dependency)

Step 5 - Format as an indented tree:
- [TARGET-1](<url>) Status, assignee
  - blocked by [KEY-A](<url>) Status, assignee
    - blocked by [KEY-B](<url>) Status, assignee  <- RISK: stale 30 days
  - blocked by [KEY-C](<url>) Status, UNASSIGNED  <- RISK

End with a one-sentence summary: "<target> is blocked by <n> direct and <m> transitive issues. Critical path: <chain>."`,
  },
  'jira-release-notes': {
    description: 'Generate release notes from issues resolved in a fixVersion.',
    text: `Generate release notes for a Jira version.

Step 1 - Identify the version:
- If user gave a version name, use it
- Else list project versions: jira_get_project_versions, pick latest unreleased (or user-specified)

Step 2 - Fetch issues resolved in that version:
- jira_search_issues with JQL:
  project = "<KEY>" AND fixVersion = "<NAME>" AND statusCategory = Done
- For each issue: jira_get_issue to pull description and issuetype

Step 3 - Group and sort:
- Features: issuetype in (Story, Task, Epic) AND labels include "feature" OR issuetype = Story
- Bug fixes: issuetype = Bug
- Improvements: everything else Done (Chore, Tech Debt, etc.)
- Within a group, sort by priority (Highest first)

Step 4 - Compose user-facing Markdown:
# <Project> <Version> - <release date>

## Highlights
<one paragraph, 2-3 sentences, written for end-users>

## New features
- [KEY-1](<url>) - Summary (rephrased as user benefit)

## Bug fixes
- [KEY-2](<url>) - Short description of what was broken

## Improvements
- [KEY-3](<url>) - Short description

## Contributors
- <Displayname> (<n> issues)
- ...

Rephrase technical summaries into user language. Keep each bullet under 120 chars.`,
  },
  'jira-velocity-check': {
    description: 'Analyze team velocity over the last N completed sprints.',
    text: `Analyze team velocity across recent sprints.

Step 1 - Pick the board:
- jira_list_boards, ask user or use project default

Step 2 - List completed sprints:
- jira_list_sprints with state="closed"
- Take the last 5 (or N specified by user)

Step 3 - For each sprint, compute:
- Committed points: sum of story points on issues present at sprint start
  (approximation: sum current story points on all sprint issues - note that scope can change mid-sprint)
- Completed points: sum of story points on issues with statusCategory = done at sprint end
- Completion rate: completed / committed
- Issue count: total issues, split by done / carried over

Data sources:
- jira_get_sprint returns issue list with story points
- For scope changes: jira_get_changelog on each issue, looking at Sprint field transitions (advanced, optional)

Step 4 - Surface patterns:
- Average velocity (mean completed points)
- Consistency (stddev / mean)
- Trend (slope of last 5 sprints - improving, flat, declining)
- Outlier sprints (>20% deviation from mean) and likely cause (vacation, incident, scope change)

Step 5 - Recommended commit for next sprint:
- Conservative: avg - 1 stddev
- Realistic: avg
- Stretch: avg + 1 stddev

Format as Markdown table + narrative summary at the end. Use clickable sprint links where possible.`,
  },
  'jira-workload-balance': {
    description: 'Snapshot current workload per assignee to detect overload.',
    text: `Snapshot who is working on what, right now.

Step 1 - Scope:
- Project key (default or user-provided)
- Optional: restrict to specific sprint via jira_get_sprint, or JQL filter

Step 2 - Pull active work:
- jira_search_issues with JQL:
  project = "<KEY>" AND statusCategory != Done AND assignee is not EMPTY
- Fields needed: summary, assignee, status, priority, storyPoints, issuetype

Step 3 - Group by assignee:
For each assignee compute:
- In-progress count and points (statusCategory = indeterminate)
- To-do count and points (statusCategory = new)
- Highest priority of active work
- Any overdue items (duedate < today)

Step 4 - Identify risks:
- Over-assigned: >2 issues in progress simultaneously (context-switching penalty)
- Under-utilized: 0 in progress, 0 to-do
- Blocker bottleneck: assignee of a blocker mentioned by jira-dependency-map
- Single-point-of-failure: only person working on a given epic/component

Step 5 - Format:
## <Project> Workload Snapshot - <date>

| Assignee | In Progress | To Do | Points (active) | Highest priority | Risk |
|----------|-------------|-------|-----------------|------------------|------|
| Alice    | 3 [links]   | 5     | 18              | Highest          | Context switch |
| Bob      | 1           | 2     | 5               | Medium           | - |

Narrative at the end: 1-2 sentences on recommended rebalancing.`,
  },
  'jira-changelog-audit': {
    description: 'Audit history of an issue - who changed what, when, and why.',
    text: `Audit the change history of a specific issue.

Step 1 - Load context:
- jira_get_issue for current state
- jira_get_changelog for full history

Step 2 - For each change entry, extract:
- When (created timestamp)
- Who (author displayName + accountId)
- Field changed (status / assignee / priority / labels / links / description / custom)
- From -> To values

Step 3 - Classify activity:
- Lifecycle transitions: status changes (To Do -> In Progress -> Done)
- Ownership changes: assignee reassignments
- Scope changes: summary edited, story points revised, labels added/removed, description rewritten
- Metadata: priority, fixVersion, components

Step 4 - Surface anomalies:
- Rapid reassignments (>3 different assignees in <7 days - hot potato)
- Back-and-forth status (Done -> In Progress reopen counts)
- Silent edits on active issue (description rewritten during In Progress without a linked comment)
- Scope creep signal (summary or story points changed after work started)

Step 5 - Format:
## History of [KEY](<url>)
### Timeline
- <date> by <name>: <field> "<from>" -> "<to>"
...

### Signals
- <observation with impact>

Keep to the most relevant 15-20 entries if history is long.`,
  },
  'jira-user-lookup': {
    description: 'Resolve accountId for a person by partial name or email.',
    text: `Find a user's accountId in Jira - required by assignment, watcher, and user-issue tools.

Step 1 - Accept input forms:
- Partial name: "alice smith"
- Email: "alice@company.com"
- Both

Step 2 - Search:
- jira_search_users with the query
- Returns list of active users matching display name or email

Step 3 - Disambiguate:
- If exactly one match -> return accountId
- If multiple -> present list as Markdown with displayName, email, accountType, active flag
- If zero -> broaden search (first name only, domain only) and retry once
- If still zero, state so explicitly - do NOT invent an accountId

Step 4 - Validate candidate:
- Optional: call jira_get_user_issues on a match to check they actually have project activity (confirms the right person)

Step 5 - Return in this exact shape:
accountId: <opaque string>
displayName: <name>
email: <email>
accountType: atlassian | app | customer

Never pass displayName or email to jira_assign_issue - always resolve to accountId first.`,
  },
  'jira-sprint-planning': {
    description: 'Pull candidates from backlog into the next sprint based on priority and capacity.',
    text: `Plan the next sprint from the backlog.

Step 1 - Find target sprint:
- jira_list_boards for the project
- jira_list_sprints with state="future" (the upcoming planned sprint)
- If none, ask user to create one via the Jira UI first

Step 2 - Determine capacity:
- Use jira-velocity-check to get average completed points over last 5 sprints
- Default target commit = 0.9 * average velocity
- Account for OOO / holidays if user mentions any

Step 3 - Pull ranked backlog:
- jira_search_issues with JQL:
  project = "<KEY>" AND status = "To Do" AND sprint is EMPTY AND issuetype in (Story, Task, Bug)
  ORDER BY priority DESC, rank ASC
- Fields: summary, priority, storyPoints, labels, issuetype, epic link

Step 4 - Fill toward capacity:
- Top-down by rank + priority
- Skip any issue missing storyPoints (flag them for refinement)
- Skip any issue labeled "blocked" or with active "is blocked by" link
- Stop once cumulative points reaches target

Step 5 - Move to sprint:
- jira_move_to_sprint with the chosen issueKeys (confirm with user first if >10)

Step 6 - Report:
## Sprint <name> plan
Target capacity: <X> points (based on <N> prior sprints, avg <Y>)
Selected: <M> issues, <P> points committed
- [KEY](<url>) - summary, <points>p, priority, epic
...

Skipped (needs refinement):
- [KEY](<url>) - missing story points
...`,
  },
  'jira-version-planning': {
    description: 'Assign issues to a fixVersion (release) based on scope and priority.',
    text: `Plan the contents of an upcoming release version.

Step 1 - Identify the version:
- jira_get_project_versions; pick one unreleased and undated, or user-specified
- If the target version does not exist, stop and ask user to create via Jira UI

Step 2 - Discover candidates:
- jira_search_issues with JQL:
  project = "<KEY>" AND fixVersion is EMPTY AND status != Done AND issuetype in (Story, Bug, Task)
  ORDER BY priority DESC

Step 3 - Bucket:
- MUST: priority Highest OR label "release-blocker"
- SHOULD: priority High, linked to committed epic
- COULD: priority Medium, fits timeline

Step 4 - Verify capacity fit:
- Sum story points in MUST bucket vs remaining capacity until release date
- If MUST exceeds capacity, flag as overcommit risk

Step 5 - Propose assignments:
For each issue to include: jira_update_issue or direct fixVersion field update
(if your MCP instance does not expose fixVersion as a first-class field, use bulk_update via the web UI or extend the tool)

Step 6 - Report plan:
## <Version> plan - target <date>
Capacity: <calculated>
MUST include (<N>p):
- [KEY](<url>)
SHOULD include (<N>p):
- [KEY](<url>)
COULD include (<N>p):
- [KEY](<url>)
Risks: <overcommit / blocker dependency / missing scope>`,
  },
  'jira-clone-template': {
    description: 'Create standardized work by cloning a template issue (onboarding, checklists, recurring tasks).',
    text: `Create a new issue from a template (saved as a reference issue in Jira).

Step 1 - Find the template:
- User names it ("onboarding template") or gives the key directly
- jira_search_issues with JQL:
  project = "<KEY>" AND labels = "template" AND summary ~ "<name>"
- Confirm match: jira_get_issue

Step 2 - Customize the clone:
- New summary (usually template summary + specific context: "Onboarding: <NewHire name>")
- Replace placeholders in description (<NAME>, <DATE>, <TEAM>) with concrete values
- Target assignee (new hire, project owner, etc.)
- Target project if cloning cross-project

Step 3 - Clone:
- jira_clone_issue with templateKey, new summary, optional targetProject
- Returns new issue key

Step 4 - Clone child subtasks if template has them:
- jira_get_issue on template - read subtask list
- For each subtask: jira_create_subtask on the new issue with the same summary (and customized description)

Step 5 - Post-clone setup:
- jira_assign_issue to the target user
- jira_add_watcher for stakeholders (manager, buddy)
- jira_add_comment: "Cloned from template [TEMPLATE-KEY](<url>)"

Step 6 - Report:
Created [NEW-KEY](<url>) from template [TEMPLATE-KEY](<url>)
Subtasks: <N> created
Watchers: <list>
Assigned to: <name>`,
  },
  'jira-subtask-breakdown': {
    description: 'Split a story or task into concrete subtasks with acceptance criteria.',
    text: `Break a parent story/task into implementation subtasks.

Step 1 - Understand the parent:
- jira_get_issue for the parent key
- Read summary, description, acceptance criteria
- Read comments for any later clarifications

Step 2 - Identify natural splits. Ask yourself:
- Is there a data model change? -> Backend schema subtask
- Is there an API change? -> Endpoint implementation subtask
- Is there UI work? -> Frontend subtask
- Are there tests required? -> Test coverage subtask
- Are there docs/migrations/ops? -> Separate subtasks

Aim for subtasks sized 0.5-2 days each. If a subtask seems bigger, split further.

Step 3 - Draft subtask list:
Each subtask:
- Summary: verb-first action ("Add POST /orders endpoint", "Write migration for orders.total column")
- Description: acceptance criteria as Markdown checklist:
  - [ ] Endpoint responds 201 with full body
  - [ ] Input validated with zod schema
  - [ ] Integration test covers happy path

Step 4 - Create subtasks:
- jira_create_subtask for each, parent = target issueKey
- Set priority same as parent (or bump highest-priority item to match)

Step 5 - Link dependencies between subtasks (if any):
- jira_link_issues with type "Blocks" / "is blocked by"
  e.g. migration blocks endpoint, endpoint blocks UI

Step 6 - Report tree:
## [PARENT](<url>) breakdown
- [SUB-1](<url>) - Backend schema (0.5d)
- [SUB-2](<url>) - API endpoint (1d, blocked by SUB-1)
- [SUB-3](<url>) - UI integration (1d, blocked by SUB-2)
- [SUB-4](<url>) - Test coverage (0.5d, parallel)

Total: ~3 days, 4 subtasks`,
  },
  'jira-backlog-grooming': {
    description: 'Find stale, ambiguous, or low-quality backlog items that need attention.',
    text: `Groom the backlog - surface issues that are stale, unclear, or duplicative.

Step 1 - Pull entire backlog:
- jira_search_issues with JQL:
  project = "<KEY>" AND status = "To Do" AND sprint is EMPTY

Step 2 - Apply quality signals:

2a. Stale (no activity):
- jira_get_changelog per issue; flag if no changes in >90 days AND no comments in >90 days
- For large backlogs, check just updated field as cheap proxy

2b. Unclear / minimal description:
- description is empty, shorter than 50 chars, or just restates the summary
- No acceptance criteria / checklist

2c. Unestimated:
- storyPoints is null for items older than 30 days

2d. Unpriotitized:
- priority is the default (Medium) AND age >60 days (likely never reviewed)

2e. Orphaned:
- Has no epic link and is not itself an Epic

2f. Possible duplicates:
- Similar summary substring to another backlog item (use naive word-overlap heuristic)
- If two candidates found, use jira-duplicate-detector for deeper check

Step 3 - Propose actions:
For each flagged issue, suggest:
- Stale + unassigned + no comments -> close (resolution: Won't Do)
- Unclear description -> comment asking reporter for acceptance criteria
- Unestimated -> mark for next refinement session
- Duplicate -> link via "Duplicates" and close one

Step 4 - Report:
## Backlog grooming report (<N> issues reviewed)
### To close (<n>)
- [KEY](<url>) - reason (stale 180d, unassigned)

### Needs clarification (<n>)
- [KEY](<url>) - description too thin, asking author

### Needs estimation (<n>)
- [KEY](<url>)

### Possible duplicates (<n>)
- [KEY-A](<url>) vs [KEY-B](<url>) - similarity: <reason>

Recommend refinement session if total flagged >20.`,
  },
  'jira-duplicate-detector': {
    description: 'Find potential duplicates of a given issue in the project.',
    text: `Detect possible duplicates of a specific issue.

Step 1 - Load target:
- jira_get_issue for the reference key
- Extract: summary words, labels, component, reporter

Step 2 - Generate search queries (try multiple, unioning results):
Query A (exact phrase):
  project = "<KEY>" AND summary ~ "\\"<first 5 words of summary>\\"" AND key != <target>
Query B (keyword overlap):
  project = "<KEY>" AND summary ~ "<top 3 non-stopword nouns>"  AND key != <target>
Query C (same component):
  project = "<KEY>" AND component = "<target component>" AND status != Done AND key != <target>

Step 3 - Score candidates:
- Summary word overlap (Jaccard similarity) - weight 0.5
- Same reporter - weight 0.1
- Same labels - weight 0.15
- Same component - weight 0.15
- Same status category (both To Do) - weight 0.1

Flag threshold: total score >= 0.5 -> probable duplicate

Step 4 - For each probable duplicate:
- jira_get_issue to read description
- jira_get_comments to check if already discussed / dismissed as duplicate

Step 5 - Report:
## Duplicates of [TARGET](<url>)
### High confidence (<n>)
- [KEY](<url>) - similarity: <score>, reason: <overlap summary>, comment thread reviewed

### Worth checking (<n>)
- [KEY](<url>) - similarity: <score>, reason

If high-confidence match found, recommend:
- jira_link_issues with linkType "Duplicate"
- jira_add_comment on the duplicate pointing to the canonical issue
- Close the duplicate

Do NOT auto-close - always let user confirm duplicate decisions.`,
  },
  'jira-estimation-helper': {
    description: 'Estimate story points for a new issue based on similar completed issues.',
    text: `Estimate story points for a new issue by referencing similar completed work.

Step 1 - Load target:
- jira_get_issue for the unestimated key (or accept draft summary+description from user)
- Extract: issuetype, component, labels, key summary nouns

Step 2 - Find comparable completed work:
- jira_search_issues with JQL:
  project = "<KEY>" AND issuetype = "<target type>" AND status = Done AND "Story Points[Number]" is not EMPTY
  AND (summary ~ "<keyword1>" OR summary ~ "<keyword2>" OR component = "<target component>")
  ORDER BY updated DESC
- Fetch top ~20 most recent

Step 3 - Narrow to truly comparable (<=10):
- Exclude issues much bigger or smaller at first glance
- Prefer ones authored by same reporter or assigned to same assignee (consistency)
- Read jira_get_issue description to confirm similar scope

Step 4 - Compute:
- Distribution of story points in comparables (min, median, max, stddev)
- Mode is usually the safest baseline for ambiguous work

Step 5 - Adjust:
- Add 1 unit if target involves: cross-team dep, new tech, external vendor, ops/infra change
- Subtract 1 unit if target is: pure copy/paste of pattern, lots of existing test coverage

Step 6 - Report:
## Estimate for [TARGET](<url>)
Recommendation: <N> story points (<confidence: high/medium/low>)

### Reference issues
| Key | Summary | Points | Why comparable |
|-----|---------|--------|----------------|
| [K1](<url>) | ... | 3 | same component, similar scope |
| [K2](<url>) | ... | 5 | same pattern, different component |

### Adjustments
- +1 for <reason>
- -1 for <reason>

Suggest refinement with team if confidence=low.`,
  },
  'jira-retro-data': {
    description: 'Collect data for a sprint retrospective (wins, misses, flow issues).',
    text: `Collect structured data for a sprint retrospective.

Step 1 - Identify the sprint:
- jira_list_sprints state="closed", pick the most recent (or user-specified)
- jira_get_sprint to pull all issues with final status

Step 2 - Collect baseline metrics:
- Committed vs completed points (see jira-velocity-check)
- Carry-overs (issues still not Done at sprint end)
- Added-mid-sprint (use jira_get_changelog on each issue, look for Sprint-field changes)
- Removed-mid-sprint (same)

Step 3 - Per-issue data useful for retro:
For each issue:
- Cycle time: created -> Done (or started In Progress -> Done)
- Number of status flips (In Progress -> To Do reopens, Code Review rounds)
- Time in each status category (indeterminate = active work vs new = waiting)
- Blocker events: any "blocked" label added or "is blocked by" link created during the sprint
- Assignee changes during sprint

Step 4 - Classify:
Wins:
- Completed issues with short cycle time and no flips
- Unblocking fast (blocker resolved within 2 days)
- Over-delivery (completing more than committed)

Misses:
- Carry-overs and their reason (blocked, scope too big, unavailable person)
- Frequent-flip issues (signals unclear acceptance criteria)
- Long in-progress durations with little change

Flow issues:
- Scope added mid-sprint (>20% of original commit)
- Bugs spiked (inflow rate during sprint vs prior)

Step 5 - Output retro draft:
## Sprint <name> retro data
### Numbers
- Committed / Completed / Carry-over / Added mid-sprint

### What went well
- [KEY](<url>) - reason
...

### What did not go well
- [KEY](<url>) - reason (blocked X days, assignee rotation)
...

### Flow signals
- <observation>

### Discussion prompts
- "Why did [KEY] flip between statuses N times?"
- "Should we cap mid-sprint additions at X points?"

Keep to data. Let the team discuss root causes.`,
  },
  'jira-epic-health': {
    description: 'Traffic-light health check per active epic (progress, blockers, pace).',
    text: `Run a health check across all active epics.

Step 1 - Get epics:
- jira_list_epics with status filter excluding Done
  or jira_get_board_epics with done="false" for a specific board

Step 2 - For each epic:
- jira_get_epic for metadata
- jira_get_epic_issues for children (done count, inProgress count, total)

Step 3 - Compute health signals:

3a. Progress:
- % done = done / total
- For target date (if set): expected % at today vs actual

3b. Pace:
- Count of issues closed in last 14 days
- If count = 0 for >14 days and epic not Done -> stalled

3c. Scope churn:
- Issues added to epic in last 14 days (compare parent field changes via jira_get_changelog)

3d. Blockers:
- Any child with "blocked" label or "is blocked by" link
- Count and list them

3e. Ownership:
- Is there a consistent assignee on child issues or scattered across many people?
- Unassigned child count

Step 4 - Assign traffic light:
- Green: progress on track, no blockers, consistent pace
- Yellow: one or two risk signals (slow pace OR scope churn OR 1-2 blockers)
- Red: multiple risks OR stalled >14d OR critical blocker unresolved >7d

Step 5 - Report:
## Epic Health Report
### Red (<n>)
- [EPIC-1](<url>) - Progress X%, stalled 21 days, 2 blockers (KEY-A, KEY-B)

### Yellow (<n>)
- [EPIC-2](<url>) - Progress X%, one blocker, scope +15% this week

### Green (<n>)
- [EPIC-3](<url>) - Progress X% on track

### Recommended actions
- Red: convene leads; resolve top blocker
- Yellow: monitor; ensure blocker has owner
- Green: continue`,
  },
  'jira-worklog-summary': {
    description: 'Summarize logged time for a user or team over a period.',
    text: `Summarize time tracking data.

Step 1 - Scope:
- User: user-specified, or jira_get_myself for current
- Team: list of accountIds or via jira_search_users for a group
- Period: default last 7 days, or user-specified

Step 2 - Gather issues the user touched:
- jira_get_user_issues for the target accountId, filter by updated within period
- Alternative broader: jira_search_issues with JQL:
  worklogAuthor = <accountId> AND worklogDate >= -7d

Step 3 - Pull worklogs per issue:
- jira_get_worklogs for each candidate issue
- Filter entries by author = target and started within period

Step 4 - Aggregate:
- Total time logged
- By issue (descending)
- By issuetype (Bug/Story/Task/etc.)
- By epic (group issues under their parent epic)
- Day-by-day breakdown (for detecting under/over-logging days)

Step 5 - Detect anomalies:
- Days with 0 logged time (forgotten worklog?)
- Single-issue bursts (>8h on one issue in a day - scope too big or logging retroactively)
- Time on Done issues (post-completion cleanup or incorrect logging?)

Step 6 - Report:
## Time log summary
Period: <from> - <to>
Person: <displayName>
Total: <Xh Ym> across <N> issues

### By issue
- [KEY](<url>) - summary - <time>
...

### By issuetype
- Bug: <time> (<%>)
- Story: <time> (<%>)
...

### By day
- Mon: <time>
- Tue: <time> (none logged - check)
...

### Signals
- <anomaly>

Useful for: timesheet export, invoice prep, capacity planning, personal retrospective.`,
  },
  'jira-attachment-review': {
    description: 'Review, download, or add attachments on an issue.',
    text: `Work with issue attachments.

Step 1 - List:
- jira_get_attachments for the issueKey
- Each entry has: id, filename, mimeType, size, url

Step 2 - Decide intent:
- Review only: skim filenames + sizes, pick which to download
- Download for analysis: pick specific attachment
- Add new: user supplies local path

Step 3 - Download:
- jira_download_attachment with attachmentId and savePath
  savePath must be inside cwd or user home (sandbox rule)
- After download, any downstream tool (e.g. image-read, text-read) can open the file locally

Step 4 - Add:
- Confirm local filePath exists (absolute path)
- jira_add_attachment with issueKey + filePath
- Mime-type and size inferred automatically

Step 5 - Report:
## Attachments on [KEY](<url>)
- <filename> (<mimeType>, <size>) - <id>
  <downloaded to: path | new upload: filename>

Never guess attachment id - always fetch list first. Never upload files from outside cwd/home.`,
  },
  'jira-watcher-management': {
    description: 'Manage issue watchers (subscribe team, audit who is watching, unsubscribe stale).',
    text: `Manage watchers on an issue.

Step 1 - Audit current state:
- jira_get_watchers for the issueKey
- Returns isWatching (for current auth user), watchCount, and list of watchers

Step 2 - Decide action:
- Subscribe someone: jira_add_watcher (accountId optional - omit to add self)
- Unsubscribe someone: jira_remove_watcher (accountId required)
- Bulk subscribe team: loop jira_add_watcher per accountId (resolve via jira-user-lookup)
- Bulk unsubscribe inactive: check active=false watchers, confirm with user, jira_remove_watcher each

Step 3 - Validate:
- Never pass displayName or email to watcher tools - resolve to accountId first (jira-user-lookup)
- Confirm with user before bulk operations >5 watchers

Step 4 - Report:
## Watchers on [KEY](<url>)
Total: <N>
- <displayName> (<accountId>) <active>
  ACTION: added | removed | unchanged
...`,
  },
  'jira-saved-views': {
    description: 'Discover and execute a saved Jira filter for recurring queries.',
    text: `Use saved Jira filters for recurring analyses.

Step 1 - Find the right filter:
- If user gave a filter name, search: jira_list_filters with filterName substring
- If user gave an owner, filter by accountId
- If nothing, list current user's own filters: jira_get_myself first, then jira_list_filters with that accountId

Step 2 - Inspect before running:
- jira_get_filter with the numeric filterId
- Review the JQL and description so the AI understands semantic intent
- Warn user if JQL is very broad or has no project clause (expensive query)

Step 3 - Run:
- jira_search_by_filter with filterId
- Optional maxResults and nextPageToken for pagination

Step 4 - Use results:
- Summarize returned issues by status/assignee/priority
- If user intent was beyond just listing (e.g. triage, status), chain into the relevant workflow prompt (jira-bug-triage, jira-standup-prep, etc.)

Step 5 - Report:
## Filter: <name> (id <filterId>)
Owner: <displayName>
JQL: <jql>
Returned: <count> issues (isLast=<bool>)

### Issues
- [KEY](<url>) - summary, status, assignee
...

Filters are a stable contract between teams - prefer them over hand-crafted JQL for recurring workflows.`,
  },
  'jira-bulk-transition': {
    description: 'Apply one status transition to many issues (with per-issue success report).',
    text: `Mass-move issues to a new status.

Step 1 - Select issues:
- Via JQL: jira_search_issues (e.g., all "Code Review" tickets for a sprint)
- Via saved filter: jira_search_by_filter
- Via user list (paste a set of keys)

Confirm the list with user before acting - there is no undo.

Step 2 - Determine the transition:
- jira_list_transitions on ONE sample issue from the set to see available transitions
- Same workflow across issues is ideal - different workflows mean transitionId varies per issue

Step 3 - Choose input mode:
- transitionId (faster, assumes same workflow): pass the id from step 2
- transitionName (slower, robust): pass the transition name; tool resolves per issue

Step 4 - Optional comment:
- Pass comment field (Markdown) to leave a trail: "Bulk-transitioned to Done by release cut on <date>"

Step 5 - Execute:
- jira_bulk_transition_issues with issueKeys + transitionId OR transitionName (+ comment)
- Returns succeeded[] and failed[{issueKey,error}]

Step 6 - Report:
## Bulk transition: <N> issues -> <status>
Succeeded (<n>): KEY-1, KEY-2, ...
Failed (<n>):
- KEY-X - reason
- KEY-Y - reason

Recommend retry for recoverable failures (permission, wrong workflow).`,
  },
  'jira-bulk-create': {
    description: 'Create many issues in one call (scaffolding a project, import from external list).',
    text: `Bulk-create issues from a structured list.

Step 1 - Gather input:
- User provides list of items (summary + description + optional issueType/priority/labels)
- Or parse from CSV / Markdown table / Google Sheet export

Step 2 - Normalize each entry:
- Default issueType to Task unless user supplied otherwise
- Default priority to Medium
- Validate labels array (no spaces)
- Convert description Markdown if provided

Step 3 - Validate vs instance:
- Call jira_get_issue_types once to confirm the issueTypes exist for the project
- Call jira_get_priorities once to confirm priorities exist
- Flag any entry with unknown issueType/priority BEFORE calling bulk create

Step 4 - Confirm with user:
Print a summary: "Creating <N> issues in project <KEY>. First 3: <preview>. Continue?"
Wait for explicit go-ahead.

Step 5 - Execute:
- jira_bulk_create_issues with the array
- Max 50 per call; split larger inputs across multiple calls

Step 6 - Report:
## Bulk create: <N> issues
Created:
- [KEY-1](<url>) - summary
- [KEY-2](<url>) - summary
...
Failed entries (if any) with reason.

Useful for: scaffolding a project backlog from a spec, importing Trello/Linear boards, seeding a template project.`,
  },
  'jira-project-overview': {
    description: 'Snapshot a project for onboarding (metadata, components, versions, epics, activity).',
    text: `Produce a project onboarding snapshot.

Step 1 - Identify the project:
- Default from JIRA_PROJECT_KEY or ask user
- If unsure, list all: jira_list_projects and ask user to pick

Step 2 - Core metadata:
- jira_get_project_info - name, key, lead, projectCategory, projectTypeKey (company vs team managed)

Step 3 - Structural data:
- Components: jira_get_project_components - each with name and optional componentLead (tells you who owns what subsystem)
- Versions: jira_get_project_versions - released and unreleased (release cadence indicator)
- Active epics: jira_list_epics with status != Done (strategic work in flight)

Step 4 - Activity:
- Active sprint: jira_list_boards -> jira_list_sprints state=active -> jira_get_sprint
- Recent issues: jira_search_issues with updated >= -14d ORDER BY updated DESC, limit 20
- Most active contributors: derive from changelog on those issues

Step 5 - Format:
## <Project name> (<KEY>)
Type: <company/team-managed> - Lead: <name>
Categories: <list>

### Components (<n>)
- <name> - lead <name or unassigned>
- ...

### Versions
Released: <list with dates>
Upcoming: <list with dates>

### Active epics (<n>)
- [EPIC-1](<url>) - summary
- ...

### Right now
- Active sprint: <name>, <N> issues, <points>
- Most active in last 14d: <top 3 contributors>

### Suggested first reads for a new team member
- [EPIC-X](<url>) - main current initiative
- Last 3 release notes: [V1](<url>), [V2](<url>), [V3](<url>)

Great first prompt to run when joining a new Jira project.`,
  },
  'jira-field-discovery': {
    description: 'Discover custom fields and enum values for the Jira instance (configuration lookup).',
    text: `Discover schema details of this Jira instance.

Step 1 - List all fields:
- jira_get_fields returns ~100+ fields per instance
- Each entry: id, name, custom (bool), schema.type

Step 2 - Filter by intent:
- "Find Story Points field id" -> search fields for name = "Story Points" (usually customfield_10016, varies per instance)
- "Find Epic Link field id" -> search for name = "Epic Link" (customfield_10014 in many instances)
- "Find Sprint field id" -> search for name = "Sprint"
- User-defined custom fields -> filter custom=true

Step 3 - List enum values where the field is not free-text:
- Issue types: jira_get_issue_types (what types can be created)
- Priorities: jira_get_priorities (what priority names are valid)
- Link types: jira_get_link_types (what link names work for jira_link_issues)
- Project-specific options for select fields: no dedicated tool; may require jira_get_issue on an existing issue that uses the field to infer values

Step 4 - Output as reference card:
## <Instance name> field map
### Well-known custom fields
- Story Points: customfield_<id>
- Epic Link: customfield_<id>
- Sprint: customfield_<id>

### Issue types for project <KEY>
- Task, Story, Bug, Sub-task, Epic, ...

### Priorities
- Highest, High, Medium, Low, Lowest, ...

### Link types
- Relates (inward "relates to", outward "relates to")
- Blocks (inward "is blocked by", outward "blocks")
- Duplicate (...), ...

Cache this snapshot locally - it rarely changes. Use it before calling jira_create_issue or jira_update_issue to avoid invalid enum values.`,
  },
  'jira-comment-maintenance': {
    description: 'Edit or remove existing comments (typo fix, redact sensitive info, delete accidental comment).',
    text: `Maintain the comment thread on an issue.

Step 1 - Load comments:
- jira_get_comments for the issueKey
- Each has: id, author, created/updated timestamps, body (ADF -> Markdown)
- Prints optionally ordered by created DESC

Step 2 - Identify target:
- Match by author + timestamp + substring of body
- If ambiguous, show user a numbered list and ask which comment id

Step 3 - Edit:
- jira_update_comment with issueKey + commentId + new Markdown body
- Use this for: typo fixes, adding links to referenced docs, redacting sensitive text, inline corrections

Step 4 - Delete:
- jira_delete_comment with issueKey + commentId
- Use sparingly: deleting is permanent; prefer edit with a strikethrough note when possible
- Always confirm deletion with user before calling

Step 5 - Leave a trail (good practice):
- When redacting, rewrite body as: "~~original sensitive text~~ (redacted <date> by <user>)"
- When fixing a typo, just edit silently
- When deleting intentionally, add a new comment explaining why (if the original had shared context)

Step 6 - Report:
## Comment edits on [KEY](<url>)
- <commentId> - edited (<reason>)
- <commentId> - deleted (<reason>)

NEVER delete someone else's comment without explicit user approval. Prefer edit over delete.`,
  },
  'jira-epic-reorg': {
    description: 'Move issues between epics (consolidation, splitting, reassignment during reorg).',
    text: `Reorganize which epic owns which issues.

Step 1 - Understand the move:
- Source epic (may be empty if pulling from no epic)
- Target epic (can be empty if removing from all epics)
- Issues to move

Step 2 - Audit the source:
- If source given: jira_get_epic_issues on source epic to see current children
- Confirm with user which specific issues to move (do not move everything by default)

Step 3 - Move to target:
- If target given: jira_add_issues_to_epic with targetKey + list of issueKeys
- If target is none (remove from epic): jira_remove_issue_from_epic with issueKeys

Step 4 - Post-move check:
- Re-fetch both epics' children: jira_get_epic_issues
- Ensure moved issues are in the new epic and not in the old

Step 5 - Leave a trail:
- jira_add_comment on each moved issue: "Moved from [EPIC-OLD](<url>) to [EPIC-NEW](<url>) on <date>: <reason>"
- This preserves history without needing to dig through the changelog

Step 6 - Report:
## Epic reorg
- Source: [EPIC-A](<url>) (was <N>, now <M>)
- Target: [EPIC-B](<url>) (was <N>, now <M>)
Moved (<count>):
- [KEY-1](<url>) - summary
- [KEY-2](<url>) - summary

Common scenarios:
- Splitting a large epic: move a coherent subset to a new epic
- Consolidating related epics: merge children of several into one
- Fixing mis-linked work: move stories linked to wrong epic after triage`,
  },
  'jira-worklog-maintenance': {
    description: 'Edit or delete an existing worklog entry (correct wrong time, fix typo in comment, remove duplicate).',
    text: `Maintain existing worklog entries on an issue.

Step 1 - Locate the worklog:
- jira_get_worklogs for the issueKey
- Each entry has: id, author, timeSpent, started, comment
- Filter by self (jira_get_myself for accountId) if user said "my entry"
- If multiple match, show numbered list and ask user which worklogId

Step 2 - Decide intent:
- Wrong duration: jira_update_worklog with new timeSpent only
- Wrong start time: jira_update_worklog with new started (ISO 8601 with millis + offset)
- Typo or missing context in comment: jira_update_worklog with new comment (Markdown)
- Accidental duplicate or wrong issue: jira_delete_worklog (permanent, confirm with user)

Step 3 - Update:
- jira_update_worklog with issueKey + worklogId + ONLY the fields that change
- Pass at least one of timeSpent / comment / started; tool errors otherwise
- timeSpent uses Jira format ("2h 30m", "1d", "45m"); started must be ISO 8601 with offset, not Z

Step 4 - Delete (last resort):
- Confirm with user: "This will permanently remove <timeSpent> logged on <started>. Proceed?"
- jira_delete_worklog with issueKey + worklogId
- After delete, recommend jira_add_worklog if the time was real but on the wrong issue

Step 5 - Verify:
- jira_get_worklogs again, confirm change applied (timeSpent / started / comment)

Step 6 - Report:
## Worklog maintenance on [KEY](<url>)
- <worklogId>: <action> (<before> -> <after> | deleted)

Common scenarios:
- Logged 2h but actually 1h45m -> update timeSpent to "1h 45m"
- Logged today but it was yesterday -> update started with absolute ISO timestamp
- Comment had a wrong issue link -> update comment
- Logged on PROJ-12 by mistake, belonged to PROJ-13 -> delete on PROJ-12, add on PROJ-13

NEVER delete someone else's worklog without explicit user approval. Prefer update over delete.`,
  },
  'jira-worklog-entry': {
    description: 'Log time spent on an issue at end of day (single entry).',
    text: `Log a worklog entry for the current user.

Step 1 - Gather input:
- issueKey (required)
- timeSpent: Jira duration format ("2h 30m", "1d", "45m", "3w 2d")
- comment: optional Markdown description of what was done
- started: optional ISO 8601 with millis and offset ("2024-01-15T09:00:00.000+0000")
  - If omitted, server uses now
  - For "yesterday morning", compute the absolute timestamp and format correctly

Step 2 - Validate inputs:
- timeSpent must match Jira pattern (w/d/h/m units, numeric values)
- started must be ISO 8601 with timezone offset (not Z)
- If user says relative times ("yesterday afternoon"), convert to absolute in their locale

Step 3 - Add the entry:
- jira_add_worklog with issueKey + timeSpent (+ optional comment, started)

Step 4 - Verify:
- jira_get_worklogs for the issue, filter by self (jira_get_myself for accountId)
- Confirm the new entry appears with correct time

Step 5 - Report:
## Worklog added
- Issue: [KEY](<url>)
- Time: <timeSpent>
- Started: <started or "now">
- Comment: <first line>

Optionally: total time logged by you this week (jira-worklog-summary).

For multiple entries in a row (end-of-day batch log), confirm each with user before posting.`,
  },
  'jira-issue-cleanup': {
    description: 'Safely delete an issue (verify no incoming links, confirm intent).',
    text: `Safely delete a Jira issue.

Step 1 - Understand why:
- User must justify: "test issue", "accidental duplicate", "withdrew feature"
- Deletion is permanent and irreversible in Jira

Step 2 - Pre-flight checks:
- jira_get_issue - does the issue exist and what is its state?
- Incoming links: from jira_get_issue response, examine issuelinks (any issue that blocks/relates to/clones this one)
- Worklogs present: jira_get_worklogs - deleting loses logged time
- Comments count: jira_get_comments - losing discussion history
- Attachments: jira_get_attachments - files are deleted too
- Sub-tasks: if parent, list them

Step 3 - Surface impact to user:
## Pre-deletion audit: [KEY](<url>)
- Type: <issuetype>, Status: <status>
- Incoming links from: [K1](<url>), [K2](<url>) (<n>)
- Worklogs: <n> entries totaling <time>
- Comments: <n>
- Attachments: <n>
- Subtasks: <n>

If ANY of the above is non-zero, REQUIRE explicit user confirmation: "This will permanently lose <data>. Proceed?"

Step 4 - Safer alternatives to offer first:
- Close with resolution "Won't Do" instead (keeps history)
- Move to an Archive project (transfer) if your workflow supports it
- Mark with label "archived" and exclude from future searches

Step 5 - If user still wants delete:
- jira_delete_issue with issueKey
- Returns success

Step 6 - Report:
Deleted <KEY> (<summary>).
Lost: <n> comments, <n> attachments, <n> worklogs totaling <time>.
Orphaned incoming links now dangle on: [K1](<url>), [K2](<url>).

NEVER delete without user confirmation. Recommend "Won't Do" resolution first.`,
  },
  'jira-weekly-report': {
    description: 'Cross-project weekly status for management (delivered / planned / risks).',
    text: `Produce a weekly status report suitable for management.

Step 1 - Scope:
- Project(s): user-specified or all via jira_list_projects
- Timeframe: default last 7 days (created/updated/resolved in that window)

Step 2 - Gather data per project:

2a. Delivered this week (resolved issues):
- jira_search_issues with JQL:
  project = "<KEY>" AND resolved >= -7d
- Group by issuetype: Story/Feature count and points, Bug count

2b. Work in progress:
- jira_search_issues with JQL:
  project = "<KEY>" AND statusCategory = "In Progress"
- Count and aggregate assignees

2c. New incoming work:
- jira_search_issues with JQL:
  project = "<KEY>" AND created >= -7d AND issuetype = Bug
- Raw bug inflow rate

2d. Risks:
- High/Highest priority issues unresolved > 14 days (aging)
- Any issue with label "blocked" or "at-risk"
- jira_get_user_issues overload signals (see jira-workload-balance)

Step 3 - Summarize executive-level:
## Week of <Mon> - <Sun>

### Delivered
- <Project>: <N> stories (<P> points), <B> bugs fixed. Highlights: [top 2-3 items with links]

### In flight
- <Project>: <N> issues in progress, <estimated completion>

### Risks
- <concise bullet per risk, linked>

### Needs decision
- [if any] items blocked by external dependency, product call, etc.

Keep each bullet outcome-focused. Avoid Jira jargon when possible. Use clickable links everywhere.`,
  },
};

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
  return {
    tools: [
      {
        name: 'jira_create_issue',
        description: 'Create a new Jira issue. Description supports Markdown (auto-converted to ADF). To create an Epic, use jira_create_epic instead (sets Epic Name field). If unsure which issueType or priority values the instance accepts, call jira_get_issue_types and jira_get_priorities first.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            summary: { type: 'string', description: 'Issue summary/title' },
            description: { type: 'string', description: 'Issue description in Markdown. Use [KEY](url) for clickable issue links.' },
            issueType: { type: 'string', description: 'Issue type name. Common: Task, Story, Bug, Sub-task. Call jira_get_issue_types for the definitive list.', default: 'Task' },
            priority: { type: 'string', description: 'Priority name. Common: Highest, High, Medium, Low, Lowest. Call jira_get_priorities if custom priorities are used.', default: 'Medium' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Labels for the issue' },
            storyPoints: { type: 'number', description: 'Story points estimate (0-1000)' },
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
          required: ['summary', 'description'],
        },
      },
      {
        name: 'jira_get_issue',
        description: 'Get details of a Jira issue',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_search_issues',
        description: 'Search for Jira issues using JQL. Uses token-based pagination — pass nextPageToken from previous response to get next page.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            jql: { type: 'string', description: 'JQL query string' },
            nextPageToken: { type: 'string', description: 'Pagination token from previous search response' },
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
          },
          required: ['jql'],
        },
      },
      {
        name: 'jira_update_issue',
        description: 'Update summary/description/status of an issue. For status changes: only transitions available on the issue work (e.g. "To Do" -> "In Progress"). If uncertain which transitions are allowed, call jira_list_transitions first. For changing priority/labels/assignee use jira_update_issue fields, or dedicated tools (jira_assign_issue).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key to update' },
            summary: { type: 'string', description: 'New summary' },
            description: { type: 'string', description: 'New description in Markdown. Use [KEY](url) for clickable issue links.' },
            status: { type: 'string', description: 'New status name (e.g. "In Progress", "Done"). Resolved to transition ID via jira_list_transitions.' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_add_comment',
        description: 'Add a comment to a Jira issue. Supports standard Markdown, automatically converted to ADF.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key' },
            comment: { type: 'string', description: 'Comment text in Markdown.' },
          },
          required: ['issueKey', 'comment'],
        },
      },
      {
        name: 'jira_update_comment',
        description: 'Update an existing comment on a Jira issue. Supports standard Markdown, automatically converted to ADF.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            commentId: { type: 'string', description: 'Comment ID (use jira_get_comments to find it)' },
            comment: { type: 'string', description: 'Updated comment text in Markdown.' },
          },
          required: ['issueKey', 'commentId', 'comment'],
        },
      },
      {
        name: 'jira_delete_comment',
        description: 'Delete a comment from a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            commentId: { type: 'string', description: 'Comment ID (use jira_get_comments to find it)' },
          },
          required: ['issueKey', 'commentId'],
        },
      },
      {
        name: 'jira_link_issues',
        description: 'Create a link between two issues. The inward side uses the linkType.inward phrasing ("is blocked by", "duplicates"), the outward side uses linkType.outward ("blocks", "is duplicated by"). If unsure which linkType names exist in this instance, call jira_get_link_types. Call sequentially (2-3 at a time) to avoid permission prompt storms in Claude Code.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            inwardIssue: { type: 'string', description: 'Issue key on the inward side (the one that "is blocked by" / "duplicates" the other)' },
            outwardIssue: { type: 'string', description: 'Issue key on the outward side (the one that "blocks" / "is duplicated by" the inward one)' },
            linkType: { type: 'string', description: 'Link type name. Common: Relates, Blocks, Duplicate, Cloners. Call jira_get_link_types for instance-specific list.', default: 'Relates' },
          },
          required: ['inwardIssue', 'outwardIssue'],
        },
      },
      {
        name: 'jira_get_project_info',
        description: 'Get project information',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Project key', default: JIRA_PROJECT_KEY },
          },
        },
      },
      {
        name: 'jira_delete_issue',
        description: 'Delete a Jira issue',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key to delete (e.g., TTC-123)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_create_subtask',
        description: 'Create a subtask under a parent issue. Description supports standard Markdown, automatically converted to ADF.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            parentKey: { type: 'string', description: 'Parent issue key (e.g., TTC-261)' },
            summary: { type: 'string', description: 'Subtask summary/title' },
            description: { type: 'string', description: 'Subtask description in Markdown. Use [KEY](url) for clickable issue links.' },
            priority: { type: 'string', description: 'Priority (Highest, High, Medium, Low, Lowest)', default: 'Medium' },
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
          required: ['parentKey', 'summary', 'description'],
        },
      },
      {
        name: 'jira_assign_issue',
        description: 'Assign or unassign a user. Jira uses accountId (not email or username). To find accountId: call jira_search_users by name/email, or jira_get_myself for the current user. Pass null accountId to unassign.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            accountId: { type: ['string', 'null'], description: 'Atlassian accountId of the assignee (opaque string like "5b10a2844c20165700ede21g"), or null to unassign. Get via jira_search_users or jira_get_myself.' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_list_transitions',
        description: 'Get available status transitions for a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_add_worklog',
        description: 'Add a worklog entry (time tracking). `timeSpent` uses Jira units: w (week), d (day, 8h by default), h (hour), m (minute). `started` must be ISO 8601 with millisecond and timezone offset, e.g. "2024-01-15T09:00:00.000+0000" (NOT a Z-terminated ISO). If omitted, server uses now.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            timeSpent: { type: 'string', description: 'Jira-style duration. Examples: "2h 30m", "1d", "45m", "3w 2d". Max units w/d/h/m.' },
            comment: { type: 'string', description: 'Worklog comment in Markdown.' },
            started: { type: 'string', description: 'Start time as ISO 8601 with millis and offset, e.g. "2024-01-15T09:00:00.000+0000". Defaults to now.' },
          },
          required: ['issueKey', 'timeSpent'],
        },
      },
      {
        name: 'jira_get_comments',
        description: 'Get comments from a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
            maxResults: { type: 'number', description: 'Maximum number of comments (1-100)', default: 50 },
            orderBy: { type: 'string', description: 'Order by created date: "created" (oldest first) or "-created" (newest first)', default: '-created' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_get_worklogs',
        description: 'Get worklog entries from a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., TTC-123)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_update_worklog',
        description: 'Update an existing worklog entry on a Jira issue. All fields except issueKey/worklogId are optional - omit to leave unchanged.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            worklogId: { type: 'string', description: 'Worklog ID (use jira_get_worklogs to find it)' },
            timeSpent: { type: 'string', description: 'New duration in Jira format ("2h 30m", "1d", "45m"). Optional.' },
            comment: { type: 'string', description: 'New comment in Markdown. Optional.' },
            started: { type: 'string', description: 'New start time as ISO 8601 with millis and offset, e.g. "2024-01-15T09:00:00.000+0000". Optional.' },
          },
          required: ['issueKey', 'worklogId'],
        },
      },
      {
        name: 'jira_delete_worklog',
        description: 'Delete a worklog entry from a Jira issue. Permanent.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            worklogId: { type: 'string', description: 'Worklog ID (use jira_get_worklogs to find it)' },
          },
          required: ['issueKey', 'worklogId'],
        },
      },
      {
        name: 'jira_list_projects',
        description: 'List all accessible Jira projects.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
            query: { type: 'string', description: 'Filter projects by name (partial match)' },
          },
        },
      },
      {
        name: 'jira_get_project_components',
        description: 'Get components of a Jira project.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
        },
      },
      {
        name: 'jira_get_project_versions',
        description: 'Get versions (releases) of a Jira project.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
        },
      },
      {
        name: 'jira_get_fields',
        description: 'Get all available Jira fields. Useful for finding custom field IDs.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'jira_get_issue_types',
        description: 'Get all available issue types for a project.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
        },
      },
      {
        name: 'jira_get_priorities',
        description: 'Get all available issue priorities.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'jira_get_link_types',
        description: 'Get all available issue link types.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'jira_search_users',
        description: 'Search for Jira users by name or email. Returns accountId needed for jira_assign_issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query (matches display name and email prefix)' },
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'jira_get_changelog',
        description: 'Get the change history of a Jira issue (who changed what and when).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            maxResults: { type: 'number', description: 'Maximum number of changelog entries (1-100)', default: 50 },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_get_user_issues',
        description: 'Get all issues assigned to a specific user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            accountId: { type: 'string', description: 'Atlassian account ID of the user' },
            projectKey: { type: 'string', description: 'Filter by project key (defaults to configured JIRA_PROJECT_KEY)' },
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
            status: { type: 'string', description: 'Filter by status (e.g., "In Progress")' },
          },
          required: ['accountId'],
        },
      },
      {
        name: 'jira_bulk_create_issues',
        description: 'Create multiple Jira issues at once. Descriptions support Markdown, automatically converted to ADF.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issues: {
              type: 'array',
              description: 'Array of issues to create',
              items: {
                type: 'object',
                properties: {
                  summary: { type: 'string', description: 'Issue summary/title' },
                  description: { type: 'string', description: 'Issue description in Markdown' },
                  issueType: { type: 'string', description: 'Issue type (Story, Task, Bug, etc.)', default: 'Task' },
                  priority: { type: 'string', description: 'Priority (Highest, High, Medium, Low, Lowest)', default: 'Medium' },
                  labels: { type: 'array', items: { type: 'string' } },
                  storyPoints: { type: 'number' },
                },
                required: ['summary'],
              },
            },
            projectKey: { type: 'string', description: 'Project key (defaults to configured JIRA_PROJECT_KEY)' },
          },
          required: ['issues'],
        },
      },
      {
        name: 'jira_clone_issue',
        description: 'Clone an existing Jira issue with a new summary.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key to clone (e.g., PROJ-123)' },
            summary: { type: 'string', description: 'Summary for the cloned issue (defaults to "Clone of <original>")' },
            projectKey: { type: 'string', description: 'Target project key (defaults to same project as source)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_list_boards',
        description: 'List all Scrum/Kanban boards.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Filter by project key' },
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
          },
        },
      },
      {
        name: 'jira_list_sprints',
        description: 'List sprints for a board.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            boardId: { type: 'number', description: 'Board ID (use jira_list_boards to find it)' },
            state: { type: 'string', description: 'Filter by state: active, future, closed', default: 'active' },
            maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'jira_get_sprint',
        description: 'Get details of a sprint including all issues in it.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            sprintId: { type: 'number', description: 'Sprint ID (use jira_list_sprints to find it)' },
            maxResults: { type: 'number', description: 'Maximum number of issues (1-100)', default: 50 },
          },
          required: ['sprintId'],
        },
      },
      {
        name: 'jira_move_to_sprint',
        description: 'Move one or more issues to a sprint.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            sprintId: { type: 'number', description: 'Sprint ID (use jira_list_sprints to find it)' },
            issueKeys: { type: 'array', items: { type: 'string' }, description: 'Array of issue keys to move (e.g., ["PROJ-1", "PROJ-2"])' },
          },
          required: ['sprintId', 'issueKeys'],
        },
      },
      {
        name: 'jira_get_attachments',
        description: 'Get list of attachments on a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_add_attachment',
        description: 'Attach a local file to a Jira issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            filePath: { type: 'string', description: 'Absolute path to the file to attach' },
          },
          required: ['issueKey', 'filePath'],
        },
      },
      {
        name: 'jira_list_epics',
        description: 'List all epics in a project via JQL (issuetype = Epic).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            projectKey: { type: 'string', description: 'Project key (defaults to JIRA_PROJECT_KEY)' },
            status: { type: 'string', description: 'Filter by status name (e.g., "In Progress", "Done")' },
            maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
            nextPageToken: { type: 'string', description: 'Pagination token from previous response' },
          },
        },
      },
      {
        name: 'jira_get_epic',
        description: 'Get epic details via Agile API (name, summary, color, done status).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            epicKey: { type: 'string', description: 'Epic issue key (e.g., PROJ-100)' },
          },
          required: ['epicKey'],
        },
      },
      {
        name: 'jira_get_epic_issues',
        description: 'Get all child issues linked to an epic.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            epicKey: { type: 'string', description: 'Epic issue key' },
            maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
          },
          required: ['epicKey'],
        },
      },
      {
        name: 'jira_get_board_epics',
        description: 'List epics on a Scrum/Kanban board, optionally filtered by done status.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            boardId: { type: 'number', description: 'Board ID (from jira_list_boards)' },
            done: { type: 'string', enum: ['true', 'false'], description: 'Filter: "true" for done epics, "false" for active, omit for all' },
            maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
          },
          required: ['boardId'],
        },
      },
      {
        name: 'jira_add_issues_to_epic',
        description: 'Link one or more issues to an epic. Uses Agile API bulk move.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            epicKey: { type: 'string', description: 'Target epic key' },
            issueKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of issue keys to attach to the epic',
            },
          },
          required: ['epicKey', 'issueKeys'],
        },
      },
      {
        name: 'jira_remove_issue_from_epic',
        description: 'Remove issues from their current epic (unlink).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of issue keys to detach from their epic',
            },
          },
          required: ['issueKeys'],
        },
      },
      {
        name: 'jira_create_epic',
        description: 'Create a new epic. Convenience wrapper that sets issueType to Epic.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            summary: { type: 'string', description: 'Epic summary' },
            description: { type: 'string', description: 'Epic description (Markdown, converted to ADF)' },
            epicName: { type: 'string', description: 'Short name for classic (company-managed) projects. Defaults to summary.' },
            projectKey: { type: 'string', description: 'Project key (defaults to JIRA_PROJECT_KEY)' },
            priority: { type: 'string', description: 'Priority name', default: 'Medium' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
          },
          required: ['summary'],
        },
      },
      {
        name: 'jira_get_myself',
        description: 'Get the authenticated user (accountId, displayName, email, timezone, locale). Useful to know who the MCP server is acting as.',
        inputSchema: { type: 'object' as const, properties: {} },
      },
      {
        name: 'jira_add_watcher',
        description: 'Subscribe a user to watch an issue (receive notifications on changes).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key (e.g., PROJ-123)' },
            accountId: { type: 'string', description: 'Atlassian accountId of the user to add as watcher. Omit to add the authenticated user.' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_remove_watcher',
        description: 'Unsubscribe a user from watching an issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key' },
            accountId: { type: 'string', description: 'Atlassian accountId to remove. Required.' },
          },
          required: ['issueKey', 'accountId'],
        },
      },
      {
        name: 'jira_get_watchers',
        description: 'List all watchers on an issue.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKey: { type: 'string', description: 'Issue key' },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_download_attachment',
        description: 'Download an attachment from Jira to a local file. Destination path must be within cwd or user home.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            attachmentId: { type: 'string', description: 'Attachment ID (from jira_get_attachments)' },
            savePath: { type: 'string', description: 'Absolute local path where the file will be written' },
          },
          required: ['attachmentId', 'savePath'],
        },
      },
      {
        name: 'jira_list_filters',
        description: 'Search saved Jira filters (by name, owner). Useful to retrieve team-defined JQL queries.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filterName: { type: 'string', description: 'Substring to match in filter name' },
            accountId: { type: 'string', description: 'Filter owner accountId (defaults to authenticated user if both name and accountId omitted)' },
            maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
          },
        },
      },
      {
        name: 'jira_get_filter',
        description: 'Get a saved filter by ID, including its JQL, description, and owner.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            filterId: { type: 'string', description: 'Numeric filter ID' },
          },
          required: ['filterId'],
        },
      },
      {
        name: 'jira_search_by_filter',
        description: "Execute a saved filter's JQL and return matching issues.",
        inputSchema: {
          type: 'object' as const,
          properties: {
            filterId: { type: 'string', description: 'Numeric filter ID' },
            maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
            nextPageToken: { type: 'string', description: 'Pagination token from previous response' },
          },
          required: ['filterId'],
        },
      },
      {
        name: 'jira_bulk_transition_issues',
        description: 'Apply the same status transition to multiple issues. Iterates client-side; failures are collected and returned.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            issueKeys: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of issue keys to transition',
            },
            transitionId: { type: 'string', description: 'Transition ID (from jira_list_transitions). Use either transitionId or transitionName.' },
            transitionName: { type: 'string', description: 'Transition name (looked up per issue). Alternative to transitionId.' },
            comment: { type: 'string', description: 'Optional comment added during the transition (Markdown)' },
          },
          required: ['issueKeys'],
        },
      },
    ],
  };
});

type ToolArgs = Record<string, unknown>;
type ToolHandler = (a: ToolArgs) => Promise<ToolResponse>;

async function handleCreateIssue(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, issueType = 'Task', priority = 'Medium', labels = [], storyPoints } = a;
  const projectKey = resolveProjectKey(a);

  validateSafeParam(issueType, 'issueType');
  validateSafeParam(priority, 'priority');
  const validatedLabels = validateLabels(labels);

  const issueData: JiraIssuePayload = {
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

async function handleGetIssue(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${a.issueKey}`);
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

async function handleSearchIssues(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, nextPageToken } = a;
  const jql = validateJQL(a.jql);
  const validatedMaxResults = validateMaxResults(maxResults);

  const params: Record<string, unknown> = {
    jql,
    maxResults: validatedMaxResults,
    fields: 'summary,status,assignee,priority,created,updated,issuetype,parent,labels',
  };
  if (nextPageToken) params.nextPageToken = nextPageToken;

  const response = await jiraApi.get('/search/jql', { params });

  const issues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    count: issues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: issues.map(issue => ({
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

async function handleUpdateIssue(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, status } = a;
  const issueKey = validateIssueKey(a.issueKey);

  const updateData: JiraIssuePayload = { fields: {} };
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

  const warnings: string[] = [];

  if (status) {
    const transitions = await jiraApi.get(`/issue/${issueKey}/transitions`);
    const transitionList: JiraTransition[] = transitions.data.transitions ?? [];
    const transition = transitionList.find(t => t.name === status);

    if (transition) {
      await jiraApi.post(`/issue/${issueKey}/transitions`, {
        transition: { id: transition.id },
      });
    } else {
      const available = transitionList.map(t => t.name).join(', ');
      warnings.push(`Transition "${status}" not found. Available transitions: ${available}`);
    }
  }

  if (!hasFieldUpdates && !status) {
    return createSuccessResponse({ success: false, message: `No updates provided for ${issueKey}` });
  }

  const result: Record<string, unknown> = {
    success: warnings.length === 0,
    message: `Issue ${issueKey} updated${warnings.length > 0 ? ' with warnings' : ' successfully'}`,
    url: createIssueUrl(issueKey),
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return createSuccessResponse(result);
}

async function handleAddComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  await jiraApi.post(`/issue/${a.issueKey}/comment`, { body: createADFDocument(a.comment) });
  return createSuccessResponse({ success: true, message: `Comment added to ${a.issueKey}` });
}

async function handleUpdateComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  validateSafeParam(a.commentId, 'commentId', 50);
  await jiraApi.put(`/issue/${a.issueKey}/comment/${a.commentId}`, { body: createADFDocument(a.comment) });
  return createSuccessResponse({ success: true, message: `Comment ${a.commentId} updated on ${a.issueKey}` });
}

async function handleDeleteComment(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  validateSafeParam(a.commentId, 'commentId', 50);
  await jiraApi.delete(`/issue/${a.issueKey}/comment/${a.commentId}`);
  return createSuccessResponse({ success: true, message: `Comment ${a.commentId} deleted from ${a.issueKey}` });
}

async function handleLinkIssues(a: ToolArgs): Promise<ToolResponse> {
  const { linkType = 'Relates' } = a;
  const inwardIssue = validateIssueKey(a.inwardIssue);
  const outwardIssue = validateIssueKey(a.outwardIssue);
  const validatedLinkType = validateSafeParam(linkType, 'linkType');

  try {
    await jiraApi.post('/issueLink', {
      type: { name: validatedLinkType },
      inwardIssue: { key: inwardIssue },
      outwardIssue: { key: outwardIssue },
    });
    return createSuccessResponse({ success: true, message: `Linked ${inwardIssue} to ${outwardIssue} with type "${validatedLinkType}"` });
  } catch (linkError) {
    const axiosErr = linkError as AxiosError<{ errorMessages?: string[] }>;
    const errorMessages = axiosErr.response?.data?.errorMessages ?? [];
    const isDuplicate = axiosErr.response?.status === 400 &&
      errorMessages.some(m => /link.*(already|exist)/i.test(m));
    if (isDuplicate) {
      return createSuccessResponse({ success: true, message: `Link between ${inwardIssue} and ${outwardIssue} already exists`, alreadyLinked: true });
    }
    throw linkError;
  }
}

async function handleGetProjectInfo(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}`);
  return createSuccessResponse({
    key: response.data.key,
    name: response.data.name,
    description: response.data.description,
    lead: response.data.lead?.displayName,
    url: response.data.url,
  });
}

async function handleDeleteIssue(a: ToolArgs): Promise<ToolResponse> {
  validateIssueKey(a.issueKey);
  await jiraApi.delete(`/issue/${a.issueKey}`);
  return createSuccessResponse({ success: true, message: `Issue ${a.issueKey} deleted successfully` });
}

async function handleCreateSubtask(a: ToolArgs): Promise<ToolResponse> {
  const { parentKey, summary, description, priority = 'Medium' } = a;
  validateIssueKey(parentKey);
  validateSafeParam(priority, 'priority');
  const projectKey = resolveProjectKey(a);

  const response = await jiraApi.post('/issue', {
    fields: {
      project: { key: projectKey },
      summary: sanitizeString(summary, 500, 'summary'),
      description: createADFDocument(description),
      issuetype: { name: 'Subtask' },
      priority: { name: priority },
      parent: { key: parentKey },
    },
  });

  return createSuccessResponse({ success: true, key: response.data.key, id: response.data.id, parent: parentKey, url: createIssueUrl(response.data.key) });
}

async function handleAssignIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = a.accountId === null || a.accountId === undefined ? null : validateAccountId(a.accountId);
  await jiraApi.put(`/issue/${issueKey}/assignee`, { accountId });
  return createSuccessResponse({
    success: true,
    message: accountId ? `Issue ${issueKey} assigned to ${accountId}` : `Issue ${issueKey} unassigned`,
    url: createIssueUrl(issueKey),
  });
}

async function handleListTransitions(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/transitions`);
  const transitions: JiraTransition[] = response.data.transitions ?? [];
  return createSuccessResponse({
    issueKey,
    transitions: transitions.map(t => ({
      id: t.id,
      name: t.name,
      to: { id: t.to?.id, name: t.to?.name, category: t.to?.statusCategory?.name },
    })),
  });
}

async function handleAddWorklog(a: ToolArgs): Promise<ToolResponse> {
  const { comment, started } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const timeSpent = sanitizeString(a.timeSpent, 50, 'timeSpent');

  const worklogData: Record<string, unknown> = { timeSpent };
  if (comment) worklogData.comment = createADFDocument(comment);
  if (started !== undefined && started !== null) worklogData.started = validateISO8601(started, 'started');

  const response = await jiraApi.post(`/issue/${issueKey}/worklog`, worklogData);
  return createSuccessResponse({ success: true, id: response.data.id, issueKey, timeSpent: response.data.timeSpent, author: response.data.author?.displayName });
}

async function handleGetComments(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, orderBy = '-created' } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const validatedMaxResults = validateMaxResults(maxResults);

  const validatedOrderBy = orderBy === 'created' ? 'created' : '-created';
  const response = await jiraApi.get(`/issue/${issueKey}/comment`, { params: { maxResults: validatedMaxResults, orderBy: validatedOrderBy } });
  const comments: JiraComment[] = response.data.comments ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? comments.length,
    comments: comments.map(c => ({
      id: c.id,
      author: c.author?.displayName,
      body: adfToText(c.body),
      created: c.created,
      updated: c.updated,
    })),
  });
}

async function handleGetWorklogs(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/worklog`);
  const worklogs: JiraWorklog[] = response.data.worklogs ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? worklogs.length,
    worklogs: worklogs.map(w => ({
      id: w.id,
      author: w.author?.displayName,
      timeSpent: w.timeSpent,
      timeSpentSeconds: w.timeSpentSeconds,
      started: w.started,
      comment: adfToText(w.comment),
    })),
  });
}

async function handleUpdateWorklog(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const worklogId = validateSafeParam(a.worklogId, 'worklogId', 50);
  const { timeSpent, comment, started } = a;

  const worklogData: Record<string, unknown> = {};
  if (timeSpent !== undefined && timeSpent !== null) {
    worklogData.timeSpent = sanitizeString(timeSpent, 50, 'timeSpent');
  }
  if (comment !== undefined && comment !== null) {
    worklogData.comment = createADFDocument(comment);
  }
  if (started !== undefined && started !== null) {
    worklogData.started = validateISO8601(started, 'started');
  }
  if (Object.keys(worklogData).length === 0) {
    throw new Error('At least one of timeSpent, comment, or started is required');
  }

  const response = await jiraApi.put(`/issue/${issueKey}/worklog/${worklogId}`, worklogData);
  return createSuccessResponse({
    success: true,
    id: response.data.id,
    issueKey,
    timeSpent: response.data.timeSpent,
    started: response.data.started,
  });
}

async function handleDeleteWorklog(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const worklogId = validateSafeParam(a.worklogId, 'worklogId', 50);
  await jiraApi.delete(`/issue/${issueKey}/worklog/${worklogId}`);
  return createSuccessResponse({ success: true, message: `Worklog ${worklogId} deleted from ${issueKey}` });
}

async function handleListProjects(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, query } = a;
  const validatedMaxResults = validateMaxResults(maxResults);
  const params: Record<string, unknown> = { maxResults: validatedMaxResults };
  if (query) params.query = sanitizeString(query, 200, 'query');

  const response = await jiraApi.get('/project/search', { params });
  const projects: JiraProject[] = response.data.values ?? [];
  return createSuccessResponse({
    total: response.data.total ?? projects.length,
    projects: projects.map(p => ({ key: p.key, name: p.name, projectTypeKey: p.projectTypeKey, style: p.style, lead: p.lead?.displayName })),
  });
}

async function handleGetProjectComponents(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/components`);
  const components: JiraComponent[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    components: components.map(c => ({ id: c.id, name: c.name, description: c.description, lead: c.lead?.displayName, assigneeType: c.assigneeType })),
  });
}

async function handleGetProjectVersions(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/project/${projectKey}/versions`);
  const versions: JiraVersion[] = response.data ?? [];
  return createSuccessResponse({
    projectKey,
    versions: versions.map(v => ({ id: v.id, name: v.name, description: v.description, released: v.released, archived: v.archived, releaseDate: v.releaseDate, startDate: v.startDate })),
  });
}

async function handleGetFields(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/field');
  const fields: JiraField[] = response.data ?? [];
  return createSuccessResponse({ fields: fields.map(f => ({ id: f.id, name: f.name, custom: f.custom, schema: f.schema })) });
}

async function handleGetIssueTypes(a: ToolArgs): Promise<ToolResponse> {
  const projectKey = resolveProjectKey(a);
  const response = await jiraApi.get(`/issue/createmeta/${projectKey}/issuetypes`);
  const issueTypes: JiraIssueType[] = response.data.values ?? [];
  return createSuccessResponse({
    projectKey,
    issueTypes: issueTypes.map(t => ({ id: t.id, name: t.name, subtask: t.subtask, description: t.description })),
  });
}

async function handleGetPriorities(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/priority/search');
  const priorities: JiraPriority[] = response.data.values ?? [];
  return createSuccessResponse({ priorities: priorities.map(p => ({ id: p.id, name: p.name, description: p.description, iconUrl: p.iconUrl })) });
}

async function handleGetLinkTypes(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/issueLinkType');
  const linkTypes: JiraLinkType[] = response.data.issueLinkTypes ?? [];
  return createSuccessResponse({ linkTypes: linkTypes.map(lt => ({ id: lt.id, name: lt.name, inward: lt.inward, outward: lt.outward })) });
}

async function handleSearchUsers(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 10 } = a;
  const query = sanitizeString(a.query, 200, 'query');
  const validatedMaxResults = validateMaxResults(maxResults);
  const response = await jiraApi.get('/user/search', { params: { query, maxResults: validatedMaxResults } });
  const users: JiraUser[] = response.data ?? [];
  return createSuccessResponse({
    users: users.map(u => ({ accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress, active: u.active, accountType: u.accountType })),
  });
}

async function handleGetChangelog(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50 } = a;
  const issueKey = validateIssueKey(a.issueKey);
  const validatedMaxResults = validateMaxResults(maxResults);

  const response = await jiraApi.get(`/issue/${issueKey}/changelog`, {
    params: { maxResults: validatedMaxResults },
  });

  const histories: JiraChangelogHistory[] = response.data.values ?? [];
  return createSuccessResponse({
    issueKey,
    total: response.data.total ?? histories.length,
    histories: histories.map(h => ({
      id: h.id,
      author: h.author?.displayName,
      created: h.created,
      items: (h.items ?? []).map(item => ({
        field: item.field,
        from: item.fromString,
        to: item.toString,
      })),
    })),
  });
}

async function handleGetUserIssues(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, status } = a;
  const accountId = validateAccountId(a.accountId);
  const validatedMaxResults = validateMaxResults(maxResults);
  const projectKey = resolveProjectKey(a);

  const escapedStatus = status ? sanitizeString(status, 100, 'status').replace(/"/g, '\\"') : null;
  let jql = `project = "${projectKey}" AND assignee = "${accountId}"`;
  if (escapedStatus) jql += ` AND status = "${escapedStatus}"`;
  jql += ' ORDER BY updated DESC';

  const response = await jiraApi.get('/search/jql', {
    params: {
      jql,
      maxResults: validatedMaxResults,
      fields: 'summary,status,priority,created,updated,issuetype,labels',
    },
  });

  const userIssues: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    count: userIssues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: userIssues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      updated: issue.fields.updated,
      url: createIssueUrl(issue.key),
    })),
  });
}

async function handleBulkCreateIssues(a: ToolArgs): Promise<ToolResponse> {
  const { issues } = a;
  const projectKey = resolveProjectKey(a);

  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error('issues must be a non-empty array');
  }
  if (issues.length > 50) {
    throw new Error('Maximum 50 issues per bulk create');
  }

  const issueList: JiraIssuePayload[] = (issues as BulkIssueInput[]).map(issue => {
    const issueType = validateSafeParam(issue.issueType ?? 'Task', 'issueType');
    const priority = validateSafeParam(issue.priority ?? 'Medium', 'priority');
    const fields: Record<string, unknown> = {
      project: { key: projectKey },
      summary: sanitizeString(issue.summary, 500, 'summary'),
      description: createADFDocument(issue.description),
      issuetype: { name: issueType },
      priority: { name: priority },
      labels: Array.isArray(issue.labels) ? validateLabels(issue.labels) : [],
    };
    if (issue.storyPoints !== undefined && issue.storyPoints !== null) {
      fields[STORY_POINTS_FIELD] = validateStoryPoints(issue.storyPoints);
    }
    return { fields };
  });

  const response = await jiraApi.post('/issue/bulk', { issueUpdates: issueList });

  const created: JiraIssue[] = response.data.issues ?? [];
  return createSuccessResponse({
    created: created.map(issue => ({
      key: issue.key,
      id: issue.id,
      url: createIssueUrl(issue.key),
    })),
    errors: response.data.errors || [],
  });
}

async function handleCloneIssue(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);

  const source = await jiraApi.get(`/issue/${issueKey}`);
  const f: JiraIssueFields = source.data.fields;
  const projectKey = a.projectKey ? validateProjectKey(a.projectKey) : f.project?.key ?? JIRA_PROJECT_KEY;
  const summary = a.summary ? sanitizeString(a.summary, 500, 'summary') : `Clone of ${f.summary}`;

  const issueData: JiraIssuePayload = {
    fields: {
      project: { key: projectKey },
      summary,
      description: f.description ?? createADFDocument(''),
      issuetype: { name: f.issuetype?.name ?? 'Task' },
      priority: { name: f.priority?.name ?? 'Medium' },
      labels: f.labels || [],
    },
  };

  if (f[STORY_POINTS_FIELD] !== undefined && f[STORY_POINTS_FIELD] !== null) {
    issueData.fields[STORY_POINTS_FIELD] = f[STORY_POINTS_FIELD];
  }

  const response = await jiraApi.post('/issue', issueData);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    clonedFrom: issueKey,
    url: createIssueUrl(response.data.key),
  });
}

async function handleListBoards(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50 } = a;
  const validatedMaxResults = validateMaxResults(maxResults);
  const params: Record<string, unknown> = { maxResults: validatedMaxResults };
  if (a.projectKey) params.projectKeyOrId = validateProjectKey(a.projectKey);

  const response = await agileApi.get('/board', { params });

  const boards: JiraBoard[] = response.data.values ?? [];
  return createSuccessResponse({
    total: response.data.total ?? boards.length,
    boards: boards.map(b => ({
      id: b.id,
      name: b.name,
      type: b.type,
      projectKey: b.location?.projectKey,
      projectName: b.location?.projectName,
    })),
  });
}

async function handleListSprints(a: ToolArgs): Promise<ToolResponse> {
  const { boardId, state = 'active', maxResults = 50 } = a;
  if (typeof boardId !== 'number') throw new Error('boardId must be a number');
  if (typeof state !== 'string' || !['active', 'future', 'closed'].includes(state)) {
    throw new Error('state must be one of: active, future, closed');
  }
  const validatedMaxResults = validateMaxResults(maxResults);

  const response = await agileApi.get(`/board/${boardId}/sprint`, {
    params: { state, maxResults: validatedMaxResults },
  });

  const sprints: JiraSprint[] = response.data.values ?? [];
  return createSuccessResponse({
    total: response.data.total ?? sprints.length,
    sprints: sprints.map(s => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate,
      endDate: s.endDate,
      goal: s.goal,
    })),
  });
}

async function handleGetSprint(a: ToolArgs): Promise<ToolResponse> {
  const { sprintId, maxResults = 50 } = a;
  if (typeof sprintId !== 'number') throw new Error('sprintId must be a number');
  const validatedMaxResults = validateMaxResults(maxResults);

  const [sprintRes, issuesRes] = await Promise.all([
    agileApi.get(`/sprint/${sprintId}`),
    agileApi.get(`/sprint/${sprintId}/issue`, {
      params: {
        maxResults: validatedMaxResults,
        fields: 'summary,status,assignee,priority,issuetype,labels',
      },
    }),
  ]);

  const sprintIssues: JiraIssue[] = issuesRes.data.issues ?? [];
  return createSuccessResponse({
    id: sprintRes.data.id,
    name: sprintRes.data.name,
    state: sprintRes.data.state,
    startDate: sprintRes.data.startDate,
    endDate: sprintRes.data.endDate,
    goal: sprintRes.data.goal,
    total: issuesRes.data.total ?? sprintIssues.length,
    issues: sprintIssues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      assignee: issue.fields.assignee?.displayName ?? null,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      url: createIssueUrl(issue.key),
    })),
  });
}

async function handleMoveToSprint(a: ToolArgs): Promise<ToolResponse> {
  const { sprintId, issueKeys } = a;
  if (typeof sprintId !== 'number') throw new Error('sprintId must be a number');
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) throw new Error('issueKeys must be a non-empty array');

  const validatedKeys = issueKeys.map((k: unknown) => validateIssueKey(k));

  await agileApi.post(`/sprint/${sprintId}/issue`, { issues: validatedKeys });

  return createSuccessResponse({
    success: true,
    sprintId,
    moved: validatedKeys,
  });
}

async function handleGetAttachments(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}`, {
    params: { fields: 'attachment' },
  });

  const attachments: JiraAttachment[] = response.data.fields?.attachment ?? [];

  return createSuccessResponse({
    issueKey,
    total: attachments.length,
    attachments: attachments.map(att => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      created: att.created,
      author: att.author?.displayName,
      url: att.content,
    })),
  });
}

async function handleAddAttachment(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const filePath = sanitizeString(a.filePath, 500, 'filePath');
  const absolutePath = validateAttachmentPath(filePath);
  const fileName = basename(absolutePath);

  const fileBuffer = readFileSync(absolutePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), fileName);

  const response = await jiraApi.post(`/issue/${issueKey}/attachments`, form, {
    headers: { 'X-Atlassian-Token': 'no-check', 'Content-Type': 'multipart/form-data' },
  });

  const attachments: JiraAttachment[] = response.data ?? [];
  return createSuccessResponse({
    success: true,
    attachments: attachments.map(att => ({
      id: att.id,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
      url: att.content,
    })),
  });
}

async function handleListEpics(a: ToolArgs): Promise<ToolResponse> {
  const { maxResults = 50, nextPageToken, status } = a;
  const projectKey = resolveProjectKey(a);
  const validatedMaxResults = validateMaxResults(maxResults);

  let jql = `project = "${projectKey}" AND issuetype = Epic`;
  if (status !== undefined && status !== null) {
    const escapedStatus = sanitizeString(status, 100, 'status').replace(/"/g, '\\"');
    jql += ` AND status = "${escapedStatus}"`;
  }
  jql += ' ORDER BY created DESC';

  const params: Record<string, unknown> = {
    jql,
    maxResults: validatedMaxResults,
    fields: 'summary,status,priority,created,updated,labels',
  };
  if (typeof nextPageToken === 'string' && nextPageToken) params.nextPageToken = nextPageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const epics: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    count: epics.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    epics: epics.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name,
      labels: issue.fields.labels || [],
      created: issue.fields.created,
      updated: issue.fields.updated,
      url: createIssueUrl(issue.key),
    })),
  });
}

async function handleGetEpic(a: ToolArgs): Promise<ToolResponse> {
  const epicKey = validateIssueKey(a.epicKey);
  const response = await agileApi.get(`/epic/${epicKey}`);
  const e = response.data;

  return createSuccessResponse({
    id: e.id,
    key: e.key,
    name: e.name,
    summary: e.summary,
    done: e.done,
    color: e.color?.key,
    url: createIssueUrl(e.key),
  });
}

async function handleGetEpicIssues(a: ToolArgs): Promise<ToolResponse> {
  const epicKey = validateIssueKey(a.epicKey);
  const { maxResults = 50 } = a;
  const validatedMaxResults = validateMaxResults(maxResults);

  const response = await agileApi.get(`/epic/${epicKey}/issue`, {
    params: {
      maxResults: validatedMaxResults,
      fields: 'summary,status,assignee,priority,issuetype,labels',
    },
  });

  const issues: JiraIssue[] = response.data.issues ?? [];
  const done = issues.filter(i => i.fields.status?.statusCategory?.key === 'done').length;
  const inProgress = issues.filter(i => i.fields.status?.statusCategory?.key === 'indeterminate').length;
  const todo = issues.filter(i => i.fields.status?.statusCategory?.key === 'new').length;

  return createSuccessResponse({
    epicKey,
    total: response.data.total ?? issues.length,
    done,
    inProgress,
    todo,
    issues: issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      statusCategory: issue.fields.status?.statusCategory?.key,
      assignee: issue.fields.assignee?.displayName ?? null,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      url: createIssueUrl(issue.key),
    })),
  });
}

async function handleGetBoardEpics(a: ToolArgs): Promise<ToolResponse> {
  const { boardId, done, maxResults = 50 } = a;
  if (typeof boardId !== 'number') throw new Error('boardId must be a number');
  const validatedMaxResults = validateMaxResults(maxResults);

  const params: Record<string, unknown> = { maxResults: validatedMaxResults };
  if (done !== undefined && done !== null) {
    if (done !== 'true' && done !== 'false') throw new Error('done must be "true" or "false"');
    params.done = done;
  }

  const response = await agileApi.get(`/board/${boardId}/epic`, { params });
  interface AgileEpic { id: number; key: string; name: string; summary: string; done: boolean; color?: { key: string } }
  const epics: AgileEpic[] = response.data.values ?? [];

  return createSuccessResponse({
    boardId,
    total: response.data.total ?? epics.length,
    isLast: response.data.isLast ?? true,
    epics: epics.map(e => ({
      id: e.id,
      key: e.key,
      name: e.name,
      summary: e.summary,
      done: e.done,
      color: e.color?.key,
      url: createIssueUrl(e.key),
    })),
  });
}

async function handleAddIssuesToEpic(a: ToolArgs): Promise<ToolResponse> {
  const epicKey = validateIssueKey(a.epicKey);
  const { issueKeys } = a;
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
    throw new Error('issueKeys must be a non-empty array');
  }
  const validatedKeys = issueKeys.map(k => validateIssueKey(k));

  await agileApi.post(`/epic/${epicKey}/issue`, { issues: validatedKeys });

  return createSuccessResponse({
    success: true,
    epicKey,
    added: validatedKeys,
  });
}

async function handleRemoveIssueFromEpic(a: ToolArgs): Promise<ToolResponse> {
  const { issueKeys } = a;
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
    throw new Error('issueKeys must be a non-empty array');
  }
  const validatedKeys = issueKeys.map(k => validateIssueKey(k));

  await agileApi.post('/epic/none/issue', { issues: validatedKeys });

  return createSuccessResponse({
    success: true,
    removed: validatedKeys,
  });
}

async function handleCreateEpic(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, epicName, priority = 'Medium', labels = [] } = a;
  const projectKey = resolveProjectKey(a);

  validateSafeParam(priority, 'priority');
  const validatedLabels = validateLabels(labels);
  const validatedSummary = sanitizeString(summary, 500, 'summary');
  const resolvedEpicName = epicName !== undefined && epicName !== null
    ? sanitizeString(epicName, 255, 'epicName')
    : validatedSummary.slice(0, 255);

  const issueData: JiraIssuePayload = {
    fields: {
      project: { key: projectKey },
      summary: validatedSummary,
      description: createADFDocument(description),
      issuetype: { name: 'Epic' },
      priority: { name: priority },
      labels: validatedLabels,
      customfield_10011: resolvedEpicName,
    },
  };

  const response = await jiraApi.post('/issue', issueData);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    url: createIssueUrl(response.data.key),
  });
}

async function handleGetMyself(_a: ToolArgs): Promise<ToolResponse> {
  const response = await jiraApi.get('/myself');
  const u = response.data;
  return createSuccessResponse({
    accountId: u.accountId,
    displayName: u.displayName,
    email: u.emailAddress,
    active: u.active,
    timeZone: u.timeZone,
    locale: u.locale,
    accountType: u.accountType,
  });
}

async function handleAddWatcher(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = a.accountId === undefined || a.accountId === null
    ? null
    : validateAccountId(a.accountId);
  await jiraApi.post(`/issue/${issueKey}/watchers`, accountId ?? '');
  return createSuccessResponse({ success: true, issueKey, accountId: accountId ?? 'self' });
}

async function handleRemoveWatcher(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const accountId = validateAccountId(a.accountId);
  await jiraApi.delete(`/issue/${issueKey}/watchers`, { params: { accountId } });
  return createSuccessResponse({ success: true, issueKey, accountId });
}

async function handleGetWatchers(a: ToolArgs): Promise<ToolResponse> {
  const issueKey = validateIssueKey(a.issueKey);
  const response = await jiraApi.get(`/issue/${issueKey}/watchers`);
  interface WatcherUser { accountId: string; displayName: string; active?: boolean }
  const watchers: WatcherUser[] = response.data.watchers ?? [];
  return createSuccessResponse({
    issueKey,
    isWatching: response.data.isWatching,
    watchCount: response.data.watchCount ?? watchers.length,
    watchers: watchers.map(w => ({
      accountId: w.accountId,
      displayName: w.displayName,
      active: w.active ?? true,
    })),
  });
}

async function handleDownloadAttachment(a: ToolArgs): Promise<ToolResponse> {
  const attachmentId = validateSafeParam(a.attachmentId, 'attachmentId', 50);
  const savePath = sanitizeString(a.savePath, 500, 'savePath');
  const absolutePath = validateAttachmentPath(savePath);

  const metaResponse = await jiraApi.get(`/attachment/${attachmentId}`);
  const meta = metaResponse.data;

  const contentResponse = await jiraApi.get(`/attachment/content/${attachmentId}`, {
    responseType: 'arraybuffer',
  });

  writeFileSync(absolutePath, Buffer.from(contentResponse.data));

  return createSuccessResponse({
    success: true,
    attachmentId,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    savedTo: absolutePath,
  });
}

async function handleListFilters(a: ToolArgs): Promise<ToolResponse> {
  const { filterName, accountId, maxResults = 50 } = a;
  const validatedMaxResults = validateMaxResults(maxResults);

  const params: Record<string, unknown> = { maxResults: validatedMaxResults, expand: 'description,jql,owner' };
  if (filterName !== undefined && filterName !== null) {
    params.filterName = sanitizeString(filterName, 200, 'filterName');
  }
  if (accountId !== undefined && accountId !== null) {
    params.accountId = validateAccountId(accountId);
  }

  const response = await jiraApi.get('/filter/search', { params });
  interface JiraFilter { id: string; name: string; description?: string; jql?: string; owner?: { accountId: string; displayName: string }; favourite?: boolean; favouritedCount?: number }
  const filters: JiraFilter[] = response.data.values ?? [];

  return createSuccessResponse({
    total: response.data.total ?? filters.length,
    isLast: response.data.isLast ?? true,
    filters: filters.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      jql: f.jql,
      owner: f.owner ? { accountId: f.owner.accountId, displayName: f.owner.displayName } : null,
      favourite: f.favourite ?? false,
      favouritedCount: f.favouritedCount ?? 0,
    })),
  });
}

async function handleGetFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);
  const response = await jiraApi.get(`/filter/${filterId}`);
  const f = response.data;
  return createSuccessResponse({
    id: f.id,
    name: f.name,
    description: f.description,
    jql: f.jql,
    owner: f.owner ? { accountId: f.owner.accountId, displayName: f.owner.displayName } : null,
    favourite: f.favourite ?? false,
    favouritedCount: f.favouritedCount ?? 0,
    viewUrl: f.viewUrl,
  });
}

async function handleSearchByFilter(a: ToolArgs): Promise<ToolResponse> {
  const filterId = validateSafeParam(a.filterId, 'filterId', 30);
  const { maxResults = 50, nextPageToken } = a;
  const validatedMaxResults = validateMaxResults(maxResults);

  const filterResponse = await jiraApi.get(`/filter/${filterId}`);
  const jql: string = filterResponse.data.jql;
  if (!jql || typeof jql !== 'string') throw new Error(`Filter ${filterId} has no JQL`);

  const params: Record<string, unknown> = {
    jql,
    maxResults: validatedMaxResults,
    fields: 'summary,status,assignee,priority,created,updated,issuetype,labels',
  };
  if (typeof nextPageToken === 'string' && nextPageToken) params.nextPageToken = nextPageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const issues: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    filterId,
    filterName: filterResponse.data.name,
    jql,
    count: issues.length,
    isLast: response.data.isLast ?? true,
    nextPageToken: response.data.nextPageToken ?? null,
    issues: issues.map(issue => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      assignee: issue.fields.assignee?.displayName ?? null,
      priority: issue.fields.priority?.name,
      issueType: issue.fields.issuetype?.name,
      labels: issue.fields.labels || [],
      url: createIssueUrl(issue.key),
    })),
  });
}

async function handleBulkTransitionIssues(a: ToolArgs): Promise<ToolResponse> {
  const { issueKeys, transitionId, transitionName, comment } = a;
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
    throw new Error('issueKeys must be a non-empty array');
  }
  if (!transitionId && !transitionName) {
    throw new Error('Either transitionId or transitionName is required');
  }
  const validatedKeys = issueKeys.map(k => validateIssueKey(k));
  const resolvedId = transitionId !== undefined && transitionId !== null
    ? validateSafeParam(transitionId, 'transitionId', 30)
    : null;
  const resolvedName = transitionName !== undefined && transitionName !== null
    ? sanitizeString(transitionName, 100, 'transitionName')
    : null;
  const commentADF = comment !== undefined && comment !== null
    ? createADFDocument(sanitizeString(comment, 5000, 'comment'))
    : null;

  const succeeded: string[] = [];
  const failed: { issueKey: string; error: string }[] = [];

  for (const issueKey of validatedKeys) {
    try {
      let effectiveId = resolvedId;
      if (!effectiveId && resolvedName) {
        const transitionsRes = await jiraApi.get(`/issue/${issueKey}/transitions`);
        interface TR { id: string; name: string }
        const transitions: TR[] = transitionsRes.data.transitions ?? [];
        const match = transitions.find(t => t.name.toLowerCase() === resolvedName.toLowerCase());
        if (!match) throw new Error(`Transition "${resolvedName}" not available on ${issueKey}`);
        effectiveId = match.id;
      }
      const payload: Record<string, unknown> = { transition: { id: effectiveId } };
      if (commentADF) {
        payload.update = { comment: [{ add: { body: commentADF } }] };
      }
      await jiraApi.post(`/issue/${issueKey}/transitions`, payload);
      succeeded.push(issueKey);
    } catch (err) {
      const axiosErr = err as AxiosError<{ errorMessages?: string[]; errors?: Record<string, string> }>;
      const apiMsg = axiosErr.response?.data?.errorMessages?.join('; ')
        || Object.values(axiosErr.response?.data?.errors ?? {}).join('; ')
        || (err instanceof Error ? err.message : String(err));
      failed.push({ issueKey, error: apiMsg });
    }
  }

  return createSuccessResponse({
    total: validatedKeys.length,
    succeeded,
    failed,
    successCount: succeeded.length,
    failedCount: failed.length,
  });
}

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
