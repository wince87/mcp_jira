export interface ADFMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ADFNode {
  type: string;
  text?: string;
  marks?: ADFMark[];
  attrs?: Record<string, unknown>;
  content?: ADFNode[];
}

export interface ADFDocument {
  type: 'doc';
  version: 1;
  content: ADFNode[];
}

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type ToolContent = TextContent | ImageContent;

export interface ToolResponse {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

export interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
  active?: boolean;
  accountType?: string;
}

export interface JiraStatusCategory {
  key?: string;
  name?: string;
}

export interface JiraStatus {
  name?: string;
  statusCategory?: JiraStatusCategory;
}

export interface JiraAttachment {
  id?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: JiraUser;
  content?: string;
}

export interface JiraIssueFields {
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

export interface JiraIssue {
  id?: string;
  key: string;
  fields: JiraIssueFields;
}

export interface JiraLinkedIssue {
  id?: string;
  key?: string;
  fields?: { summary?: string; status?: JiraStatus };
}

export interface JiraIssueLink {
  id?: string;
  type?: { id?: string; name?: string; inward?: string; outward?: string };
  inwardIssue?: JiraLinkedIssue;
  outwardIssue?: JiraLinkedIssue;
}

export interface JiraComment {
  id?: string;
  author?: JiraUser;
  body?: unknown;
  created?: string;
  updated?: string;
}

export interface JiraWorklog {
  id?: string;
  author?: JiraUser;
  timeSpent?: string;
  timeSpentSeconds?: number;
  started?: string;
  comment?: unknown;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { id?: string; name?: string; statusCategory?: JiraStatusCategory };
}

export interface JiraChangelogItem {
  field?: string;
  fromString?: string;
  toString?: string;
}

export interface JiraChangelogHistory {
  id?: string;
  author?: JiraUser;
  created?: string;
  items?: JiraChangelogItem[];
}

export interface JiraProject {
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  lead?: JiraUser;
  url?: string;
  projectTypeKey?: string;
  style?: string;
}

export interface JiraIssueType {
  id?: string;
  name?: string;
  subtask?: boolean;
  description?: string;
}

export interface JiraPriority {
  id?: string;
  name?: string;
  description?: string;
  iconUrl?: string;
}

export interface JiraLinkType {
  id?: string;
  name?: string;
  inward?: string;
  outward?: string;
}

export interface JiraField {
  id?: string;
  name?: string;
  custom?: boolean;
  schema?: { type?: string; custom?: string };
}

export interface CreateMetaAllowedValue {
  id?: string;
  value?: string;
  name?: string;
  key?: string;
}

export interface CreateMetaField {
  fieldId?: string;
  key?: string;
  name?: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; custom?: string; items?: string; system?: string };
  allowedValues?: CreateMetaAllowedValue[];
  autoCompleteUrl?: string;
}

export interface CreateMetaResult {
  issueType: JiraIssueType;
  fields: CreateMetaField[];
}

export interface MetaValidationReport {
  missingRequired: { fieldId: string; name?: string; type?: string; allowedValues?: unknown }[];
  invalidValues: { fieldId: string; name?: string; sent: unknown; allowedValues?: unknown }[];
  unknownFields: string[];
}

export interface JiraComponent {
  id?: string;
  name?: string;
  description?: string;
  lead?: JiraUser;
  assigneeType?: string;
}

export interface JiraVersion {
  id?: string;
  name?: string;
  description?: string;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string;
  startDate?: string;
}

export interface JiraFilter {
  id?: string;
  name?: string;
  description?: string;
  jql?: string;
  owner?: JiraUser;
  favourite?: boolean;
  favouritedCount?: number;
  viewUrl?: string;
}

export interface AgileEpic {
  id?: number;
  key?: string;
  name?: string;
  summary?: string;
  done?: boolean;
  color?: { key?: string };
}

export interface JiraBoard {
  id?: number;
  name?: string;
  type?: string;
  location?: { projectKey?: string; projectName?: string };
}

export interface JiraSprint {
  id?: number;
  name?: string;
  state?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface BulkIssueInput {
  summary?: unknown;
  description?: unknown;
  issueType?: unknown;
  priority?: unknown;
  labels?: unknown;
  storyPoints?: unknown;
  customFields?: unknown;
}

export interface JiraIssuePayload {
  fields: Record<string, unknown>;
}

export type ToolArgs = Record<string, unknown>;
export type ToolHandler = (a: ToolArgs) => Promise<ToolResponse>;
