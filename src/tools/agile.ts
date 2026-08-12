import type { AgileEpic, JiraBoard, JiraIssue, JiraSprint, ToolArgs, ToolResponse } from '../types.js';
import { agileApi, jiraApi } from '../http.js';
import { numericId, offsetPage, offsetParams, present, readMaxResults, readPageToken, tokenPage } from '../args.js';
import { issueListFieldsParam, issueSnapshot, mapIssueList, mapSprint, readIssueListOptions } from '../mappers.js';
import { buildJql, equalsClause } from '../jql.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateISODateTime, validateIssueKey, validateProjectKey } from '../validation.js';
import {
  applyOptionalFields, dryRunResult, metaFieldId, postIssue, resolveIssueTypeValue, safeCreateMeta,
} from '../meta.js';
import { defineTool } from '../registry.js';
import { PRIORITY_SCHEMA, COMMON_ISSUE_FIELDS_SCHEMA } from '../schemas.js';
import { JIRA_PROJECT_KEY } from '../config.js';

export async function handleListBoards(a: ToolArgs): Promise<ToolResponse> {
  const params: Record<string, unknown> = offsetParams(a);
  if (a.projectKey) params.projectKeyOrId = validateProjectKey(a.projectKey);

  const response = await agileApi.get('/board', { params });

  const boards: JiraBoard[] = response.data.values ?? [];
  return createSuccessResponse({
    ...offsetPage(response.data, boards.length, params),
    boards: boards.map(b => ({
      id: b.id,
      name: b.name,
      type: b.type,
      projectKey: b.location?.projectKey,
      projectName: b.location?.projectName,
    })),
  });
}

export async function handleListSprints(a: ToolArgs): Promise<ToolResponse> {
  const { state = 'active' } = a;
  const boardId = numericId(a.boardId, 'boardId');
  if (typeof state !== 'string' || !['active', 'future', 'closed'].includes(state)) {
    throw new Error('state must be one of: active, future, closed');
  }

  const params = { ...offsetParams(a), state };
  const response = await agileApi.get(`/board/${boardId}/sprint`, { params });

  const sprints: JiraSprint[] = response.data.values ?? [];
  return createSuccessResponse({
    ...offsetPage(response.data, sprints.length, params),
    sprints: sprints.map(mapSprint),
  });
}

export async function handleGetSprint(a: ToolArgs): Promise<ToolResponse> {
  const sprintId = numericId(a.sprintId, 'sprintId');
  const options = readIssueListOptions(a);

  const [sprintRes, issuesRes] = await Promise.all([
    agileApi.get(`/sprint/${sprintId}`),
    agileApi.get(`/sprint/${sprintId}/issue`, {
      params: { ...offsetParams(a), fields: issueListFieldsParam(options) },
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
    ...offsetPage(issuesRes.data, sprintIssues.length, offsetParams(a)),
    issues: await mapIssueList(sprintIssues, options),
  });
}

export async function handleMoveToSprint(a: ToolArgs): Promise<ToolResponse> {
  const { issueKeys } = a;
  const sprintId = numericId(a.sprintId, 'sprintId');
  if (!Array.isArray(issueKeys) || issueKeys.length === 0) throw new Error('issueKeys must be a non-empty array');

  const validatedKeys = issueKeys.map((k: unknown) => validateIssueKey(k));

  await agileApi.post(`/sprint/${sprintId}/issue`, { issues: validatedKeys });

  return createSuccessResponse({
    success: true,
    sprintId,
    moved: validatedKeys,
  });
}

export async function handleListEpics(a: ToolArgs): Promise<ToolResponse> {
  const { nextPageToken, status } = a;
  const projectKey = resolveProjectKey(a);

  const jql = buildJql({
    clauses: [
      equalsClause('project', projectKey, 'projectKey'),
      'issuetype = Epic',
      present(status) ? equalsClause('status', status, 'status') : '',
    ],
    orderBy: 'created DESC',
  });

  const options = readIssueListOptions(a);
  const params: Record<string, unknown> = { jql, maxResults: readMaxResults(a), fields: issueListFieldsParam(options) };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const epics: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    ...tokenPage(response.data, epics.length),
    epics: await mapIssueList(epics, options),
  });
}

export async function handleGetEpic(a: ToolArgs): Promise<ToolResponse> {
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

export async function handleGetEpicIssues(a: ToolArgs): Promise<ToolResponse> {
  const epicKey = validateIssueKey(a.epicKey);
  const options = readIssueListOptions(a);

  const response = await agileApi.get(`/epic/${epicKey}/issue`, {
    params: { ...offsetParams(a), fields: issueListFieldsParam(options) },
  });

  const issues: JiraIssue[] = response.data.issues ?? [];
  const done = issues.filter(i => i.fields.status?.statusCategory?.key === 'done').length;
  const inProgress = issues.filter(i => i.fields.status?.statusCategory?.key === 'indeterminate').length;
  const todo = issues.filter(i => i.fields.status?.statusCategory?.key === 'new').length;

  return createSuccessResponse({
    epicKey,
    ...offsetPage(response.data, issues.length, offsetParams(a)),
    done,
    inProgress,
    todo,
    issues: await mapIssueList(issues, options),
  });
}

export async function handleGetBoardEpics(a: ToolArgs): Promise<ToolResponse> {
  const { done } = a;
  const boardId = numericId(a.boardId, 'boardId');

  const params: Record<string, unknown> = offsetParams(a);
  if (done !== undefined && done !== null) {
    if (done !== 'true' && done !== 'false') throw new Error('done must be "true" or "false"');
    params.done = done;
  }

  const response = await agileApi.get(`/board/${boardId}/epic`, { params });
  const epics: AgileEpic[] = response.data.values ?? [];

  return createSuccessResponse({
    boardId,
    ...offsetPage(response.data, epics.length, params),
    epics: epics.map(e => ({
      id: e.id,
      key: e.key,
      name: e.name,
      summary: e.summary,
      done: e.done,
      color: e.color?.key,
      url: e.key ? createIssueUrl(e.key) : null,
    })),
  });
}

export async function handleAddIssuesToEpic(a: ToolArgs): Promise<ToolResponse> {
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

export async function handleRemoveIssueFromEpic(a: ToolArgs): Promise<ToolResponse> {
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

export async function handleCreateEpic(a: ToolArgs): Promise<ToolResponse> {
  const { summary, description, epicName } = a;
  const projectKey = resolveProjectKey(a);
  const meta = await safeCreateMeta(projectKey, 'Epic');

  const validatedSummary = sanitizeString(summary, 500, 'summary');
  const resolvedEpicName = epicName !== undefined && epicName !== null
    ? sanitizeString(epicName, 255, 'epicName')
    : validatedSummary.slice(0, 255);

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: validatedSummary,
    description: createADFDocument(description),
    issuetype: await resolveIssueTypeValue('Epic', projectKey),
  };

  if (!meta || meta.fields.some(f => metaFieldId(f) === 'customfield_10011')) {
    fields.customfield_10011 = resolvedEpicName;
  }

  await applyOptionalFields(a, fields, meta);

  if (a.dryRun === true) {
    return createSuccessResponse(dryRunResult(projectKey, 'Epic', fields, meta));
  }

  const response = await postIssue(projectKey, 'Epic', fields);

  return createSuccessResponse({
    success: true,
    key: response.data.key,
    id: response.data.id,
    url: createIssueUrl(response.data.key),
    issue: await issueSnapshot(response.data.key),
  });
}

export const ListBoardsTool = defineTool({
  name: 'jira_list_boards',
  description: 'List all Scrum/Kanban boards.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Filter by project key' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
  },
  handler: handleListBoards,
});

export const ListSprintsTool = defineTool({
  name: 'jira_list_sprints',
  description: 'List sprints for a board.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      boardId: { type: 'number', description: 'Board ID (use jira_list_boards to find it)' },
      state: { type: 'string', description: 'Filter by state: active, future, closed', default: 'active' },
      maxResults: { type: 'number', description: 'Maximum number of results (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
    required: ['boardId'],
  },
  handler: handleListSprints,
});

export const GetSprintTool = defineTool({
  name: 'jira_get_sprint',
  description: 'Get details of a sprint including all issues in it.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sprintId: { type: 'number', description: 'Sprint ID (use jira_list_sprints to find it)' },
      maxResults: { type: 'number', description: 'Maximum number of issues (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
    },
    required: ['sprintId'],
  },
  handler: handleGetSprint,
});

export const MoveToSprintTool = defineTool({
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
  handler: handleMoveToSprint,
});

export const ListEpicsTool = defineTool({
  name: 'jira_list_epics',
  description: 'List all epics in a project via JQL (issuetype = Epic).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      projectKey: { type: 'string', description: 'Project key (defaults to JIRA_PROJECT_KEY)' },
      status: { type: 'string', description: 'Filter by status name (e.g., "In Progress", "Done")' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      nextPageToken: { type: 'string', description: 'Pagination token from previous response' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per epic, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every epic. Rich-text fields render as Markdown.', default: false },
    },
  },
  handler: handleListEpics,
});

export const GetEpicTool = defineTool({
  name: 'jira_get_epic',
  description: 'Get epic details via Agile API (name, summary, color, done status).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      epicKey: { type: 'string', description: 'Epic issue key (e.g., PROJ-100)' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
    },
    required: ['epicKey'],
  },
  handler: handleGetEpic,
});

export const GetEpicIssuesTool = defineTool({
  name: 'jira_get_epic_issues',
  description: 'Get all child issues linked to an epic.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      epicKey: { type: 'string', description: 'Epic issue key' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Exact field IDs to return per issue, e.g. ["summary", "customfield_10122"] or ["*all"]. When set, each item returns a raw fields map instead of the default shape.' },
      includeCustomFields: { type: 'boolean', description: 'Add a customFields map (id -> { name, type, value }) to every issue. Rich-text fields render as Markdown. Requests all fields, so prefer an explicit fields list on large result sets.', default: false },
    },
    required: ['epicKey'],
  },
  handler: handleGetEpicIssues,
});

export const GetBoardEpicsTool = defineTool({
  name: 'jira_get_board_epics',
  description: 'List epics on a Scrum/Kanban board, optionally filtered by done status.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      boardId: { type: 'number', description: 'Board ID (from jira_list_boards)' },
      done: { type: 'string', enum: ['true', 'false'], description: 'Filter: "true" for done epics, "false" for active, omit for all' },
      maxResults: { type: 'number', description: 'Maximum results (1-100)', default: 50 },
      startAt: { type: 'number', description: 'Zero-based index of the first item to return. Use it with the returned startAt/total/hasMore to page beyond the first batch.' },
    },
    required: ['boardId'],
  },
  handler: handleGetBoardEpics,
});

export const AddIssuesToEpicTool = defineTool({
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
  handler: handleAddIssuesToEpic,
});

export const RemoveIssueFromEpicTool = defineTool({
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
  handler: handleRemoveIssueFromEpic,
});

export const CreateEpicTool = defineTool({
  name: 'jira_create_epic',
  description: 'Create a new epic. Convenience wrapper that sets issueType to Epic.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      summary: { type: 'string', description: 'Epic summary' },
      description: { type: 'string', description: 'Epic description (Markdown, converted to ADF)' },
      epicName: { type: 'string', description: 'Short name for classic (company-managed) projects. Sent only when the create screen actually has the Epic Name field.' },
      projectKey: { type: 'string', description: 'Project key (defaults to JIRA_PROJECT_KEY)' },
      priority: PRIORITY_SCHEMA,
      ...COMMON_ISSUE_FIELDS_SCHEMA,
      dryRun: { type: 'boolean', description: 'When true, validate against the create screen and return what is missing without creating the epic.', default: false },
    },
    required: ['summary'],
  },
  handler: handleCreateEpic,
});

export async function handleCreateSprint(a: ToolArgs): Promise<ToolResponse> {
  const originBoardId = numericId(a.boardId, 'boardId');
  const payload: Record<string, unknown> = {
    name: sanitizeString(a.name, 255, 'name'),
    originBoardId,
  };
  if (present(a.goal)) payload.goal = sanitizeString(a.goal, 500, 'goal');
  if (present(a.startDate)) payload.startDate = validateISODateTime(a.startDate, 'startDate');
  if (present(a.endDate)) payload.endDate = validateISODateTime(a.endDate, 'endDate');

  const response = await agileApi.post('/sprint', payload);
  return createSuccessResponse({ success: true, sprint: mapSprint(response.data) });
}

const SPRINT_STATES = ['future', 'active', 'closed'];

export async function handleUpdateSprint(a: ToolArgs): Promise<ToolResponse> {
  const sprintId = numericId(a.sprintId, 'sprintId');
  const payload: Record<string, unknown> = {};

  if (present(a.name)) payload.name = sanitizeString(a.name, 255, 'name');
  if (present(a.goal)) payload.goal = sanitizeString(a.goal, 500, 'goal');
  if (present(a.startDate)) payload.startDate = validateISODateTime(a.startDate, 'startDate');
  if (present(a.endDate)) payload.endDate = validateISODateTime(a.endDate, 'endDate');
  if (present(a.state)) {
    const state = sanitizeString(a.state, 20, 'state').toLowerCase();
    if (!SPRINT_STATES.includes(state)) {
      throw new Error(`state must be one of: ${SPRINT_STATES.join(', ')}`);
    }
    payload.state = state;
  }
  if (Object.keys(payload).length === 0) {
    throw new Error('Provide at least one of name, goal, startDate, endDate or state');
  }

  const response = await agileApi.post(`/sprint/${sprintId}`, payload);
  return createSuccessResponse({ success: true, sprint: mapSprint(response.data) });
}

export async function handleDeleteSprint(a: ToolArgs): Promise<ToolResponse> {
  const sprintId = numericId(a.sprintId, 'sprintId');
  await agileApi.delete(`/sprint/${sprintId}`);
  return createSuccessResponse({ success: true, message: `Sprint ${sprintId} deleted permanently` });
}

export const CreateSprintTool = defineTool({
  name: 'jira_create_sprint',
  description: 'Create a sprint on a Scrum board. A new sprint starts in the "future" state; use jira_update_sprint with state "active" to start it. Board ids come from jira_list_boards.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      boardId: { type: 'number', description: 'Board the sprint belongs to (use jira_list_boards)' },
      name: { type: 'string', description: 'Sprint name' },
      goal: { type: 'string', description: 'Sprint goal' },
      startDate: { type: 'string', description: 'ISO 8601 with timezone, e.g. "2026-08-01T09:00:00.000Z"' },
      endDate: { type: 'string', description: 'ISO 8601 with timezone' },
    },
    required: ['boardId', 'name'],
  },
  handler: handleCreateSprint,
});

export const UpdateSprintTool = defineTool({
  name: 'jira_update_sprint',
  description: 'Update a sprint: rename it, set the goal or dates, or move it through the workflow with state ("future" -> "active" -> "closed"). Starting a sprint requires startDate and endDate to be set. Closing a sprint moves unfinished issues to the backlog in Jira, so confirm before setting state to "closed".',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sprintId: { type: 'number', description: 'Sprint ID (use jira_list_sprints)' },
      name: { type: 'string', description: 'New sprint name' },
      goal: { type: 'string', description: 'New sprint goal' },
      startDate: { type: 'string', description: 'ISO 8601 with timezone' },
      endDate: { type: 'string', description: 'ISO 8601 with timezone' },
      state: { type: 'string', enum: ['future', 'active', 'closed'], description: 'Sprint state' },
    },
    required: ['sprintId'],
  },
  handler: handleUpdateSprint,
});

export const DeleteSprintTool = defineTool({
  name: 'jira_delete_sprint',
  description: 'Permanently delete a sprint. Issues in it are moved to the backlog. This cannot be undone -- confirm with the user first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sprintId: { type: 'number', description: 'Sprint ID (use jira_list_sprints)' },
    },
    required: ['sprintId'],
  },
  handler: handleDeleteSprint,
});

export const AGILE_TOOLS = [
  CreateSprintTool,
  UpdateSprintTool,
  DeleteSprintTool,
  ListBoardsTool,
  ListSprintsTool,
  GetSprintTool,
  MoveToSprintTool,
  ListEpicsTool,
  GetEpicTool,
  GetEpicIssuesTool,
  GetBoardEpicsTool,
  AddIssuesToEpicTool,
  RemoveIssueFromEpicTool,
  CreateEpicTool,
];
