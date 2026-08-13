import { JIRA_PROJECT_KEY } from './config.js';
import { jiraApi } from './http.js';
import { fetchIssueTypes, fetchPriorities } from './meta.js';
import type { JiraProject } from './types.js';

const MAX_COMPLETIONS = 50;

async function projectKeys(): Promise<string[]> {
  const response = await jiraApi.get('/project/search', { params: { maxResults: 100 } });
  const projects: JiraProject[] = response.data.values ?? [];
  return projects.map(p => p.key).filter((key): key is string => typeof key === 'string');
}

export async function completionsFor(name: string, typed: string): Promise<string[]> {
  const prefix = typed.trim().toLowerCase();
  const matching = (values: string[]): string[] => values
    .filter(value => value.toLowerCase().startsWith(prefix))
    .slice(0, MAX_COMPLETIONS);

  try {
    switch (name) {
      case 'projectKey':
        return matching(await projectKeys());
      case 'issueType':
        return matching((await fetchIssueTypes(JIRA_PROJECT_KEY)).map(t => t.name ?? '').filter(Boolean));
      case 'priority':
        return matching((await fetchPriorities()).map(p => p.id ?? '').filter(Boolean));
      case 'state':
        return matching(['active', 'future', 'closed']);
      default:
        return [];
    }
  } catch {
    return [];
  }
}
