import type { JiraField, JiraIssueFields } from './types.js';
import { jiraApi } from './http.js';
import { STORY_POINTS_FIELD } from './config.js';
import { adfToText } from './adf.js';
import { createIssueUrl } from './responses.js';
import { fetchFieldIndex } from './meta.js';

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

export function mapIssue(data: { key: string; fields?: JiraIssueFields }): Record<string, unknown> {
  const f = data.fields ?? {};
  return {
    key: data.key,
    summary: f.summary,
    description: adfToText(f.description),
    status: f.status?.name,
    resolution: (f.resolution as { name?: string } | null | undefined)?.name ?? null,
    assignee: f.assignee ? { displayName: f.assignee.displayName, accountId: f.assignee.accountId } : null,
    reporter: f.reporter?.displayName,
    priority: f.priority?.name,
    issueType: f.issuetype?.name,
    labels: f.labels || [],
    storyPoints: f[STORY_POINTS_FIELD],
    parent: f.parent?.key,
    components: namesOf(f.components),
    versions: namesOf(f.versions),
    fixVersions: namesOf(f.fixVersions),
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
