import type {
  JiraAttachment, JiraComment, JiraComponent, JiraField, JiraFilter, JiraIssue, JiraIssueFields, JiraIssueLink,
  JiraProject, JiraSprint, JiraUser, JiraVersion, JiraWorklog,
} from './types.js';
import { agileApi, jiraApi } from './http.js';
import { STORY_POINTS_FIELD } from './config.js';
import { adfToText } from './adf.js';
import { createIssueUrl } from './responses.js';
import { fetchFieldIndex } from './meta.js';
import { validateExpandList, validateFieldSelection } from './validation.js';
import { offsetPage, offsetParams, present, readMaxResults, readPageToken, tokenPage } from './args.js';

export function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (item && typeof item === 'object' ? (item as { name?: string }).name : undefined))
    .filter((name): name is string => typeof name === 'string');
}

export function simplifyFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simplifyFieldValue);
  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (entry.type === 'doc') return adfToText(value);
    if (typeof entry.value === 'string') return entry.value;
    if (typeof entry.name === 'string') return entry.name;
    if (typeof entry.displayName === 'string') return entry.displayName;
  }
  return value;
}

export const ISSUE_LIST_FIELDS = [
  'summary', 'status', 'assignee', 'priority', 'issuetype', 'parent', 'labels', 'created', 'updated',
  STORY_POINTS_FIELD,
].join(',');

export function mapUser(user: JiraUser | null | undefined): Record<string, unknown> | null {
  if (!user) return null;
  return { accountId: user.accountId, displayName: user.displayName };
}

export function mapIssueSummary(issue: JiraIssue): Record<string, unknown> {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    assignee: mapUser(f.assignee),
    priority: f.priority?.name,
    issueType: f.issuetype?.name,
    parent: f.parent?.key ?? null,
    labels: f.labels || [],
    storyPoints: f[STORY_POINTS_FIELD] ?? null,
    created: f.created,
    updated: f.updated,
    url: createIssueUrl(issue.key),
  };
}

export function mapIssueLinks(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const link = raw as JiraIssueLink;
    const outward = link.outwardIssue;
    const other = outward ?? link.inwardIssue;
    if (!other?.key) return [];
    return [{
      id: link.id,
      type: link.type?.name,
      direction: outward ? 'outward' : 'inward',
      relation: outward ? link.type?.outward : link.type?.inward,
      key: other.key,
      summary: other.fields?.summary,
      status: other.fields?.status?.name,
      url: createIssueUrl(other.key),
    }];
  });
}

export function mapIssue(data: { key: string; fields?: JiraIssueFields }): Record<string, unknown> {
  const f = data.fields ?? {};
  return {
    key: data.key,
    summary: f.summary,
    description: adfToText(f.description),
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    resolution: (f.resolution as { name?: string } | null | undefined)?.name ?? null,
    assignee: mapUser(f.assignee),
    reporter: mapUser(f.reporter),
    priority: f.priority?.name,
    issueType: f.issuetype?.name,
    labels: f.labels || [],
    storyPoints: f[STORY_POINTS_FIELD],
    parent: f.parent?.key ?? null,
    components: namesOf(f.components),
    versions: namesOf(f.versions),
    fixVersions: namesOf(f.fixVersions),
    links: mapIssueLinks(f.issuelinks),
    dueDate: f.duedate ?? null,
    timetracking: f.timetracking ?? null,
    created: f.created,
    updated: f.updated,
    url: createIssueUrl(data.key),
  };
}

export async function mapCustomFields(fields: JiraIssueFields): Promise<Record<string, unknown>> {
  let index: Map<string, JiraField>;
  try {
    index = await fetchFieldIndex();
  } catch {
    index = new Map<string, JiraField>();
  }

  const result: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (!id.startsWith('customfield_') || value === null || value === undefined) continue;
    const meta = index.get(id);
    result[id] = {
      name: meta?.name ?? id,
      type: meta?.schema?.type,
      value: meta?.schema?.type === 'doc' ? adfToText(value) : simplifyFieldValue(value),
    };
  }
  return result;
}

export async function issueSnapshot(issueKey: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await jiraApi.get(`/issue/${issueKey}`);
    return mapIssue(response.data);
  } catch {
    return null;
  }
}

export interface IssueListOptions {
  selection: string[] | null;
  includeCustomFields: boolean;
}

export function readIssueListOptions(a: Record<string, unknown>): IssueListOptions {
  return {
    selection: a.fields !== undefined && a.fields !== null ? validateFieldSelection(a.fields) : null,
    includeCustomFields: a.includeCustomFields === true,
  };
}

export function issueListFieldsParam(options: IssueListOptions): string {
  if (options.selection) return options.selection.join(',');
  return options.includeCustomFields ? '*all' : ISSUE_LIST_FIELDS;
}

export async function mapIssueList(issues: JiraIssue[], options: IssueListOptions): Promise<Record<string, unknown>[]> {
  const mapped = issues.map(issue => (options.selection
    ? {
      key: issue.key,
      url: createIssueUrl(issue.key),
      fields: Object.fromEntries(Object.entries(issue.fields ?? {}).map(([id, value]) => [id, simplifyFieldValue(value)])),
    }
    : mapIssueSummary(issue)));

  if (!options.includeCustomFields) return mapped;

  for (let i = 0; i < mapped.length; i++) {
    mapped[i].customFields = await mapCustomFields(issues[i].fields ?? {});
  }
  return mapped;
}

export function mapComment(comment: JiraComment): Record<string, unknown> {
  return {
    id: comment.id,
    author: mapUser(comment.author),
    body: adfToText(comment.body),
    created: comment.created,
    updated: comment.updated,
  };
}

export function mapWorklog(worklog: JiraWorklog): Record<string, unknown> {
  return {
    id: worklog.id,
    author: mapUser(worklog.author),
    timeSpent: worklog.timeSpent,
    timeSpentSeconds: worklog.timeSpentSeconds,
    started: worklog.started,
    comment: adfToText(worklog.comment),
  };
}

export function mapAttachment(attachment: JiraAttachment): Record<string, unknown> {
  return {
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    mimeType: attachment.mimeType,
    created: attachment.created,
    author: mapUser(attachment.author),
    url: attachment.content,
  };
}

export function mapVersion(version: JiraVersion): Record<string, unknown> {
  return {
    id: version.id,
    name: version.name,
    description: version.description,
    released: version.released ?? false,
    archived: version.archived ?? false,
    startDate: version.startDate ?? null,
    releaseDate: version.releaseDate ?? null,
  };
}

export function mapComponent(component: JiraComponent): Record<string, unknown> {
  return {
    id: component.id,
    name: component.name,
    description: component.description,
    lead: mapUser(component.lead),
    assigneeType: component.assigneeType,
  };
}

export function mapSprint(sprint: JiraSprint): Record<string, unknown> {
  return {
    id: sprint.id,
    name: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    goal: sprint.goal ?? null,
  };
}

export function mapFilter(filter: JiraFilter): Record<string, unknown> {
  return {
    id: filter.id,
    name: filter.name,
    description: filter.description,
    jql: filter.jql,
    owner: mapUser(filter.owner),
    favourite: filter.favourite ?? false,
    favouritedCount: filter.favouritedCount ?? 0,
    viewUrl: filter.viewUrl,
  };
}

export function mapProject(project: JiraProject): Record<string, unknown> {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    lead: mapUser(project.lead),
    projectTypeKey: project.projectTypeKey,
    style: project.style,
    url: project.url,
  };
}

export function mapWatcher(watcher: JiraUser): Record<string, unknown> {
  return { accountId: watcher.accountId, displayName: watcher.displayName, active: watcher.active ?? true };
}

export async function runJqlSearch(
  jql: string,
  a: Record<string, unknown>,
  collection: string = 'issues',
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const options = readIssueListOptions(a);
  const params: Record<string, unknown> = {
    jql,
    maxResults: readMaxResults(a),
    fields: issueListFieldsParam(options),
  };
  const pageToken = readPageToken(a);
  if (pageToken) params.nextPageToken = pageToken;
  if (present(a.expand)) params.expand = validateExpandList(a.expand).join(',');

  const response = await jiraApi.get('/search/jql', { params });
  const issues: JiraIssue[] = response.data.issues ?? [];

  return {
    ...extra,
    ...tokenPage(response.data, issues.length),
    [collection]: await mapIssueList(issues, options),
  };
}

export async function runAgileIssueList(
  path: string,
  a: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ body: Record<string, unknown>; issues: JiraIssue[] }> {
  const options = readIssueListOptions(a);
  const params = { ...offsetParams(a), fields: issueListFieldsParam(options) };
  const response = await agileApi.get(path, { params });
  const issues: JiraIssue[] = response.data.issues ?? [];

  return {
    issues,
    body: {
      ...extra,
      ...offsetPage(response.data, issues.length, params),
      issues: await mapIssueList(issues, options),
    },
  };
}
