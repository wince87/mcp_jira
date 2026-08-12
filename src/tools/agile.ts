import type { JiraBoard, JiraIssue, JiraSprint, ToolArgs, ToolResponse } from '../types.js';
import { agileApi, jiraApi } from '../http.js';
import { numericId, offsetPage, offsetParams, present, readMaxResults, readPageToken, tokenPage } from '../args.js';
import { ISSUE_LIST_FIELDS, issueSnapshot, mapIssueSummary } from '../mappers.js';
import { buildJql, equalsClause } from '../jql.js';
import { createADFDocument } from '../adf.js';
import { createIssueUrl, createSuccessResponse, resolveProjectKey } from '../responses.js';
import { sanitizeString, validateIssueKey, validateProjectKey } from '../validation.js';
import {
  applyOptionalFields, dryRunResult, metaFieldId, postIssue, resolveIssueTypeValue, safeCreateMeta,
} from '../meta.js';

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
      params: { ...offsetParams(a), fields: ISSUE_LIST_FIELDS },
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
    issues: sprintIssues.map(mapIssueSummary),
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

  const params: Record<string, unknown> = { jql, maxResults: readMaxResults(a), fields: ISSUE_LIST_FIELDS };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;

  const response = await jiraApi.get('/search/jql', { params });
  const epics: JiraIssue[] = response.data.issues ?? [];

  return createSuccessResponse({
    ...tokenPage(response.data, epics.length),
    epics: epics.map(mapIssueSummary),
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
    params: { ...offsetParams(a), fields: ISSUE_LIST_FIELDS },
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
    issues: issues.map(mapIssueSummary),
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
  interface AgileEpic { id: number; key: string; name: string; summary: string; done: boolean; color?: { key: string } }
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
