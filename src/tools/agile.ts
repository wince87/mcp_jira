import type { JiraBoard, JiraIssue, JiraSprint, ToolArgs, ToolResponse } from '../types.js';
import { numericId, present, readMaxResults } from '../args.js';
import { agileApi, jiraApi } from '../http.js';
import { buildJql, equalsClause } from '../jql.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateIssueKey, validateMaxResults, validateProjectKey } from '../validation.js';
import {
  applyOptionalFields, dryRunResult, metaFieldId, postIssue, resolveIssueTypeValue, safeCreateMeta,
} from '../meta.js';
import { issueSnapshot } from '../mappers.js';

export async function handleListBoards(a: ToolArgs): Promise<ToolResponse> {
  const params: Record<string, unknown> = { maxResults: readMaxResults(a) };
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

export async function handleListSprints(a: ToolArgs): Promise<ToolResponse> {
  const { state = 'active' } = a;
  const boardId = numericId(a.boardId, 'boardId');
  if (typeof state !== 'string' || !['active', 'future', 'closed'].includes(state)) {
    throw new Error('state must be one of: active, future, closed');
  }

  const response = await agileApi.get(`/board/${boardId}/sprint`, {
    params: { state, maxResults: readMaxResults(a) },
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

export async function handleGetSprint(a: ToolArgs): Promise<ToolResponse> {
  const sprintId = numericId(a.sprintId, 'sprintId');

  const [sprintRes, issuesRes] = await Promise.all([
    agileApi.get(`/sprint/${sprintId}`),
    agileApi.get(`/sprint/${sprintId}/issue`, {
      params: {
        maxResults: readMaxResults(a),
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

  const params: Record<string, unknown> = {
    jql,
    maxResults: readMaxResults(a),
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

  const response = await agileApi.get(`/epic/${epicKey}/issue`, {
    params: {
      maxResults: readMaxResults(a),
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

export async function handleGetBoardEpics(a: ToolArgs): Promise<ToolResponse> {
  const { done } = a;
  const boardId = numericId(a.boardId, 'boardId');

  const params: Record<string, unknown> = { maxResults: readMaxResults(a) };
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
