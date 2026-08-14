import type { AxiosError } from 'axios';
import type {
  CreateMetaAllowedValue, CreateMetaField, CreateMetaResult, JiraField, JiraIssueType, JiraPriority,
  MetaValidationReport,
} from './types.js';
import { jiraApi } from './http.js';
import { STORY_POINTS_FIELD } from './config.js';
import { JiraDiagnosticError } from './errors.js';
import { createADFDocument } from './adf.js';
import {
  sanitizeString, validateAccountId, validateCustomFields, validateDate, validateIssueKey, validateLabels,
  validateReferenceList, validateSafeParam, validateStoryPoints, validateTimetracking,
} from './validation.js';

export const META_TTL_MS = 5 * 60 * 1000;
export const MAX_ALLOWED_VALUES = 100;

export interface CacheEntry<T> {
  at: number;
  value: T;
}

export function cacheGet<T>(store: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = store.get(key);
  if (!hit || Date.now() - hit.at > META_TTL_MS) return null;
  return hit.value;
}

export const issueTypesCache = new Map<string, CacheEntry<JiraIssueType[]>>();
export const createFieldsCache = new Map<string, CacheEntry<CreateMetaField[]>>();
export const fieldIndexCache = new Map<string, CacheEntry<Map<string, JiraField>>>();
export const prioritiesCache = new Map<string, CacheEntry<JiraPriority[]>>();
const projectIdCache = new Map<string, CacheEntry<string>>();

export async function fetchProjectId(projectKey: string): Promise<string> {
  const cached = cacheGet(projectIdCache, projectKey);
  if (cached) return cached;
  const response = await jiraApi.get(`/project/${projectKey}`);
  const value = response.data?.id;
  if (typeof value !== 'string') {
    throw new Error(`Could not resolve a numeric project id for ${projectKey}`);
  }
  projectIdCache.set(projectKey, { at: Date.now(), value });
  return value;
}

export async function fetchIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
  const cached = cacheGet(issueTypesCache, projectKey);
  if (cached) return cached;
  const response = await jiraApi.get(`/issue/createmeta/${projectKey}/issuetypes`, { params: { maxResults: 200 } });
  // This page keys its list `issueTypes`, unlike every other paginated
  // Jira endpoint, which uses `values`. Reading both keeps the tool
  // working whichever shape an instance returns.
  const value: JiraIssueType[] = response.data.issueTypes ?? response.data.values ?? [];
  issueTypesCache.set(projectKey, { at: Date.now(), value });
  return value;
}

export async function fetchCreateFields(projectKey: string, issueTypeId: string): Promise<CreateMetaField[]> {
  const cacheKey = `${projectKey}:${issueTypeId}`;
  const cached = cacheGet(createFieldsCache, cacheKey);
  if (cached) return cached;
  const response = await jiraApi.get(`/issue/createmeta/${projectKey}/issuetypes/${issueTypeId}`, { params: { maxResults: 200 } });
  const value: CreateMetaField[] = response.data.fields ?? response.data.values ?? [];
  createFieldsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function fetchFieldIndex(): Promise<Map<string, JiraField>> {
  const cached = cacheGet(fieldIndexCache, 'all');
  if (cached) return cached;
  const response = await jiraApi.get('/field');
  const fields: JiraField[] = response.data ?? [];
  const value = new Map<string, JiraField>();
  for (const field of fields) {
    if (field.id) value.set(field.id, field);
  }
  fieldIndexCache.set('all', { at: Date.now(), value });
  return value;
}

export async function fetchPriorities(): Promise<JiraPriority[]> {
  const cached = cacheGet(prioritiesCache, 'all');
  if (cached) return cached;
  const response = await jiraApi.get('/priority/search', { params: { maxResults: 100 } });
  const value: JiraPriority[] = response.data.values ?? [];
  prioritiesCache.set('all', { at: Date.now(), value });
  return value;
}

export async function resolveIssueType(projectKey: string, issueType: string): Promise<JiraIssueType | null> {
  const types = await fetchIssueTypes(projectKey);
  if (/^\d+$/.test(issueType)) {
    return types.find(t => t.id === issueType) ?? { id: issueType };
  }
  const wanted = issueType.trim().toLowerCase();
  return types.find(t => (t.name ?? '').trim().toLowerCase() === wanted) ?? null;
}

export async function loadCreateMeta(projectKey: string, issueType: unknown): Promise<CreateMetaResult | null> {
  if (typeof issueType !== 'string' || !issueType.trim()) return null;
  const resolved = await resolveIssueType(projectKey, issueType);
  if (!resolved?.id) return null;
  return { issueType: resolved, fields: await fetchCreateFields(projectKey, resolved.id) };
}

export async function safeCreateMeta(projectKey: string, issueType: unknown): Promise<CreateMetaResult | null> {
  try {
    return await loadCreateMeta(projectKey, issueType);
  } catch {
    return null;
  }
}

export function metaFieldId(field: CreateMetaField): string {
  return field.fieldId ?? field.key ?? '';
}

export function describeAllowedValues(field: CreateMetaField): unknown {
  if (!field.allowedValues?.length) return undefined;
  const values = field.allowedValues.slice(0, MAX_ALLOWED_VALUES).map(v => ({
    id: v.id,
    value: v.value ?? v.name ?? v.key,
  }));
  return field.allowedValues.length > MAX_ALLOWED_VALUES
    ? { truncated: true, total: field.allowedValues.length, values }
    : values;
}

export function matchAllowedValue(allowed: CreateMetaAllowedValue[] | undefined, input: string): CreateMetaAllowedValue | null {
  if (!allowed?.length) return null;
  const wanted = input.trim().toLowerCase();
  return allowed.find(v => [v.id, v.name, v.value, v.key].some(
    candidate => typeof candidate === 'string' && candidate.trim().toLowerCase() === wanted,
  )) ?? null;
}

export function valueLabels(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(valueLabels);
  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    return ['id', 'name', 'value', 'key']
      .map(k => entry[k])
      .filter((v): v is string => typeof v === 'string');
  }
  return [];
}

export async function resolveIssueTypeValue(issueType: unknown, projectKey: string): Promise<Record<string, string>> {
  const value = validateSafeParam(issueType, 'issueType');
  if (/^\d+$/.test(value)) return { id: value };
  try {
    const resolved = await resolveIssueType(projectKey, value);
    if (resolved?.id) return { id: resolved.id };
  } catch {
    return { name: value };
  }
  return { name: value };
}

export async function resolvePriorityValue(priority: unknown, meta: CreateMetaResult | null): Promise<Record<string, string>> {
  const value = validateSafeParam(priority, 'priority');
  if (/^\d+$/.test(value)) return { id: value };

  const metaField = meta?.fields.find(f => metaFieldId(f) === 'priority');
  const metaMatch = matchAllowedValue(metaField?.allowedValues, value);
  if (metaMatch?.id) return { id: metaMatch.id };

  try {
    const priorities = await fetchPriorities();
    const match = priorities.find(p => (p.name ?? '').trim().toLowerCase() === value.trim().toLowerCase() || p.id === value);
    if (match?.id) return { id: match.id };
  } catch {
    return { name: value };
  }
  return { name: value };
}

export async function docFieldIds(keys: string[], meta: CreateMetaResult | null): Promise<Set<string>> {
  const docs = new Set<string>();
  const metaById = new Map((meta?.fields ?? []).map(f => [metaFieldId(f), f]));
  const unresolved: string[] = [];

  for (const key of keys) {
    const field = metaById.get(key);
    if (field) {
      if (field.schema?.type === 'doc') docs.add(key);
    } else {
      unresolved.push(key);
    }
  }

  if (unresolved.length > 0) {
    try {
      const index = await fetchFieldIndex();
      for (const key of unresolved) {
        if (index.get(key)?.schema?.type === 'doc') docs.add(key);
      }
    } catch {
      return docs;
    }
  }
  return docs;
}

export async function convertDocFields(fields: Record<string, unknown>, meta: CreateMetaResult | null): Promise<Record<string, unknown>> {
  const stringKeys = Object.keys(fields).filter(key => typeof fields[key] === 'string');
  if (stringKeys.length === 0) return fields;

  const docs = await docFieldIds(stringKeys, meta);
  if (docs.size === 0) return fields;

  const result = { ...fields };
  for (const key of docs) {
    result[key] = createADFDocument(result[key]);
  }
  return result;
}

export function validateAgainstMeta(fields: Record<string, unknown>, meta: CreateMetaResult): MetaValidationReport {
  const known = new Map(meta.fields.map(f => [metaFieldId(f), f]));

  const missingRequired = meta.fields
    .filter(f => f.required === true && f.hasDefaultValue !== true && fields[metaFieldId(f)] === undefined)
    .map(f => ({
      fieldId: metaFieldId(f),
      name: f.name,
      type: f.schema?.type,
      allowedValues: describeAllowedValues(f),
    }));

  const invalidValues: MetaValidationReport['invalidValues'] = [];
  for (const [fieldId, value] of Object.entries(fields)) {
    const field = known.get(fieldId);
    if (!field?.allowedValues?.length) continue;
    const labels = valueLabels(value);
    if (labels.length === 0) continue;
    if (labels.some(label => matchAllowedValue(field.allowedValues, label))) continue;
    invalidValues.push({ fieldId, name: field.name, sent: value, allowedValues: describeAllowedValues(field) });
  }

  const unknownFields = Object.keys(fields).filter(key => !known.has(key));

  return { missingRequired, invalidValues, unknownFields };
}

export function collectDiagnostics(
  fields: Record<string, unknown>,
  meta: CreateMetaResult,
  error: unknown,
  hint: string,
  options: { checkRequired?: boolean } = {},
): Record<string, unknown> | null {
  const axiosError = error as AxiosError<{ errors?: Record<string, string> }>;
  const report = validateAgainstMeta(fields, meta);
  if (options.checkRequired === false) report.missingRequired = [];
  const mentioned = new Set(Object.keys(axiosError.response?.data?.errors ?? {}));

  const allowedValues: Record<string, unknown> = {};
  for (const field of meta.fields) {
    const fieldId = metaFieldId(field);
    if (!mentioned.has(fieldId) && !mentioned.has(field.name ?? '')) continue;
    const values = describeAllowedValues(field);
    if (values !== undefined) allowedValues[fieldId] = values;
  }

  const diagnostics: Record<string, unknown> = {};
  if (report.missingRequired.length > 0) diagnostics.missingRequired = report.missingRequired;
  if (report.invalidValues.length > 0) diagnostics.invalidValues = report.invalidValues;
  if (report.unknownFields.length > 0) diagnostics.fieldsNotOnScreen = report.unknownFields;
  if (Object.keys(allowedValues).length > 0) diagnostics.allowedValues = allowedValues;
  if (Object.keys(diagnostics).length === 0) return null;

  diagnostics.hint = hint;
  return diagnostics;
}

export async function postIssue(projectKey: string, issueType: unknown, fields: Record<string, unknown>): Promise<{ data: { key: string; id?: string } }> {
  try {
    return await jiraApi.post('/issue', { fields });
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.status !== 400) throw error;
    const meta = await safeCreateMeta(projectKey, issueType);
    const hint = `Create screen for ${meta?.issueType.name ?? issueType} in ${projectKey}. Call jira_get_create_fields for the full field list; pass ids, not localized names.`;
    const diagnostics = meta ? collectDiagnostics(fields, meta, error, hint) : null;
    if (diagnostics) throw new JiraDiagnosticError(error, diagnostics);
    throw error;
  }
}

export async function safeEditMeta(issueKey: string): Promise<CreateMetaResult | null> {
  try {
    const response = await jiraApi.get(`/issue/${issueKey}/editmeta`);
    const raw: Record<string, CreateMetaField> = response.data.fields ?? {};
    return {
      issueType: { name: issueKey },
      fields: Object.entries(raw).map(([fieldId, field]) => ({ ...field, fieldId })),
    };
  } catch {
    return null;
  }
}

export async function putIssue(
  issueKey: string,
  fields: Record<string, unknown>,
  update?: Record<string, unknown>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (Object.keys(fields).length > 0) payload.fields = fields;
  if (update && Object.keys(update).length > 0) payload.update = update;

  try {
    await jiraApi.put(`/issue/${issueKey}`, payload);
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response?.status !== 400) throw error;
    const meta = await safeEditMeta(issueKey);
    const hint = `Edit screen for ${issueKey}. Fields listed under fieldsNotOnScreen are not editable on this issue.`;
    // Partial updates legitimately omit required fields that are already
    // set on the issue, so a missingRequired report would only mislead.
    const diagnostics = meta
      ? collectDiagnostics(fields, meta, error, hint, { checkRequired: false })
      : null;
    if (diagnostics) throw new JiraDiagnosticError(error, diagnostics);
    throw error;
  }
}

export function describeMetaField(field: CreateMetaField): Record<string, unknown> {
  return {
    fieldId: metaFieldId(field),
    name: field.name,
    required: field.required === true,
    type: field.schema?.type,
    itemsType: field.schema?.items,
    custom: field.schema?.custom,
    hasDefaultValue: field.hasDefaultValue === true,
    allowedValues: describeAllowedValues(field),
    autoCompleteUrl: field.autoCompleteUrl,
  };
}

export async function applyOptionalFields(a: Record<string, unknown>, fields: Record<string, unknown>, meta: CreateMetaResult | null): Promise<void> {
  if (a.labels !== undefined && a.labels !== null) {
    fields.labels = validateLabels(a.labels);
  }
  if (a.priority !== undefined && a.priority !== null) {
    fields.priority = await resolvePriorityValue(a.priority, meta);
  }
  if (a.storyPoints !== undefined && a.storyPoints !== null) {
    fields[STORY_POINTS_FIELD] = validateStoryPoints(a.storyPoints);
  }
  if (a.versions !== undefined && a.versions !== null) {
    fields.versions = validateReferenceList(a.versions, 'versions');
  }
  if (a.fixVersions !== undefined && a.fixVersions !== null) {
    fields.fixVersions = validateReferenceList(a.fixVersions, 'fixVersions');
  }
  if (a.components !== undefined && a.components !== null) {
    fields.components = validateReferenceList(a.components, 'components');
  }
  if (a.parent !== undefined && a.parent !== null) {
    fields.parent = { key: validateIssueKey(a.parent) };
  }
  if (a.assignee !== undefined && a.assignee !== null) {
    fields.assignee = { accountId: validateAccountId(a.assignee) };
  }
  if (a.reporter !== undefined && a.reporter !== null) {
    fields.reporter = { accountId: validateAccountId(a.reporter) };
  }
  if (a.dueDate !== undefined && a.dueDate !== null) {
    fields.duedate = validateDate(a.dueDate, 'dueDate');
  }
  if (a.timetracking !== undefined && a.timetracking !== null) {
    fields.timetracking = validateTimetracking(a.timetracking);
  }
  if (a.customFields !== undefined && a.customFields !== null) {
    Object.assign(fields, await convertDocFields(validateCustomFields(a.customFields), meta));
  }
  if (a.customFieldsMarkdown !== undefined && a.customFieldsMarkdown !== null) {
    for (const [key, value] of Object.entries(validateCustomFields(a.customFieldsMarkdown))) {
      fields[key] = createADFDocument(sanitizeString(value, 32000, key));
    }
  }
}

export function dryRunResult(projectKey: string, issueType: unknown, fields: Record<string, unknown>, meta: CreateMetaResult | null): Record<string, unknown> {
  if (!meta) {
    return {
      dryRun: true,
      valid: null,
      message: `Create metadata unavailable for issue type "${String(issueType)}" in ${projectKey} (unknown type or no browse permission). Payload was not validated.`,
      payload: { fields },
    };
  }
  const report = validateAgainstMeta(fields, meta);
  return {
    dryRun: true,
    valid: report.missingRequired.length === 0 && report.invalidValues.length === 0 && report.unknownFields.length === 0,
    projectKey,
    issueType: { id: meta.issueType.id, name: meta.issueType.name },
    missingRequired: report.missingRequired,
    invalidValues: report.invalidValues,
    fieldsNotOnScreen: report.unknownFields,
    payload: { fields },
  };
}
