import type { AxiosError } from 'axios';
import type { CreateMetaField, JiraTransition } from './types.js';
import { jiraApi } from './http.js';
import { JiraDiagnosticError } from './errors.js';
import { collectDiagnostics, describeMetaField } from './meta.js';

export function resolveTransition(
  transitions: JiraTransition[],
  wanted: { id?: string | null; status?: string | null },
): JiraTransition | undefined {
  if (wanted.id) {
    return transitions.find(t => t.id === wanted.id);
  }
  if (!wanted.status) return undefined;
  const needle = wanted.status.trim().toLowerCase();
  return transitions.find(t => (t.to?.name ?? '').trim().toLowerCase() === needle)
    ?? transitions.find(t => (t.name ?? '').trim().toLowerCase() === needle);
}

export function describeTransitions(transitions: JiraTransition[]): string {
  return transitions.map(t => `${t.name} -> ${t.to?.name ?? '?'} (id ${t.id})`).join(', ');
}

export async function fetchTransitions(issueKey: string): Promise<JiraTransition[]> {
  const response = await jiraApi.get(`/issue/${issueKey}/transitions`);
  return response.data.transitions ?? [];
}

export async function fetchTransitionFields(issueKey: string, transitionId: string): Promise<CreateMetaField[] | null> {
  try {
    const response = await jiraApi.get(`/issue/${issueKey}/transitions`, { params: { expand: 'transitions.fields', transitionId } });
    const transitions: (JiraTransition & { fields?: Record<string, CreateMetaField> })[] = response.data.transitions ?? [];
    const raw = transitions.find(t => t.id === transitionId)?.fields;
    if (!raw) return null;
    return Object.entries(raw).map(([fieldId, field]) => ({ ...field, fieldId }));
  } catch {
    return null;
  }
}

export async function postTransition(issueKey: string, transitionId: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await jiraApi.post(`/issue/${issueKey}/transitions`, payload);
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.status !== 400) throw error;
    const fields = await fetchTransitionFields(issueKey, transitionId);
    if (!fields) throw error;
    const sent = (payload.fields ?? {}) as Record<string, unknown>;
    const hint = `Transition screen for ${issueKey}. Pass the fields it requires via transitionFields.`;
    const diagnostics = collectDiagnostics(sent, { issueType: { id: transitionId }, fields }, error, hint) ?? {};
    diagnostics.transitionFields = fields.map(describeMetaField);
    throw new JiraDiagnosticError(error, diagnostics);
  }
}
