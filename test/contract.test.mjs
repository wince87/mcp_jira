import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';
import { matchSnapshot, requestTrace } from './snapshot.mjs';

const TMP_DIR = join(dirname(fileURLToPath(import.meta.url)), '.tmp');
const UPLOAD_PATH = join(TMP_DIR, 'upload.txt');
const DOWNLOAD_PATH = join(TMP_DIR, 'downloaded.png');

let mock;
let server;

before(async () => {
  mkdirSync(TMP_DIR, { recursive: true });
  writeFileSync(UPLOAD_PATH, 'attachment fixture');
  mock = await startMock();
  server = await startServer({ url: mock.url });
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

beforeEach(() => mock.reset());

const CASES = [
  ['jira_create_issue', { summary: 'New task', description: 'Body **bold**' }],
  ['jira_create_issue__full', { summary: 'Bug report', description: 'Steps', issueType: 'Помилка', priority: 'Високий', versions: ['1.0'], fixVersions: ['10101'], components: ['Auth'], assignee: '5b10a2844c20165700ede21g', dueDate: '2026-09-01', timetracking: { originalEstimate: '3h' }, labels: ['regression'], customFields: { customfield_10500: '**QA** notes' } }, 'jira_create_issue'],
  ['jira_create_issue__dry_run', { summary: 'Bug report', description: 'Steps', issueType: 'Помилка', dryRun: true }, 'jira_create_issue'],
  ['jira_get_issue', { issueKey: 'TEST-1' }],
  ['jira_get_issue__custom_fields', { issueKey: 'TEST-1', includeCustomFields: true }, 'jira_get_issue'],
  ['jira_get_issue__field_selection', { issueKey: 'TEST-1', fields: ['summary', 'versions'] }, 'jira_get_issue'],
  ['jira_get_issue__images', { issueKey: 'TEST-1', includeImages: true }, 'jira_get_issue'],
  ['jira_search_issues', { jql: 'project = TEST ORDER BY created DESC' }],
  ['jira_update_issue', { issueKey: 'TEST-1', summary: 'Renamed', description: 'New body' }],
  ['jira_update_issue__transition', { issueKey: 'TEST-1', status: 'To Do' }, 'jira_update_issue'],
  ['jira_update_issue__transition_fields', { issueKey: 'TEST-1', status: 'In Progress', transitionFields: { customfield_10016: 5 } }, 'jira_update_issue'],
  ['jira_add_comment', { issueKey: 'TEST-1', comment: 'A comment with **bold**' }],
  ['jira_update_comment', { issueKey: 'TEST-1', commentId: '30001', comment: 'Edited' }],
  ['jira_delete_comment', { issueKey: 'TEST-1', commentId: '30001' }],
  ['jira_link_issues', { inwardIssue: 'TEST-1', outwardIssue: 'TEST-2', linkType: 'Blocks' }],
  ['jira_get_project_info', { projectKey: 'TEST' }],
  ['jira_delete_issue', { issueKey: 'TEST-2' }],
  ['jira_create_subtask', { parentKey: 'TEST-1', summary: 'Subtask', description: 'Do the thing' }],
  ['jira_assign_issue', { issueKey: 'TEST-1', accountId: '5b10a2844c20165700ede21g' }],
  ['jira_assign_issue__unassign', { issueKey: 'TEST-1', accountId: null }, 'jira_assign_issue'],
  ['jira_list_transitions', { issueKey: 'TEST-1' }],
  ['jira_list_transitions__fields', { issueKey: 'TEST-1', includeFields: true }, 'jira_list_transitions'],
  ['jira_add_worklog', { issueKey: 'TEST-1', timeSpent: '1h', comment: 'Worked' }],
  ['jira_get_comments', { issueKey: 'TEST-1' }],
  ['jira_get_worklogs', { issueKey: 'TEST-1' }],
  ['jira_update_worklog', { issueKey: 'TEST-1', worklogId: '40001', timeSpent: '3h' }],
  ['jira_delete_worklog', { issueKey: 'TEST-1', worklogId: '40001' }],
  ['jira_list_projects', {}],
  ['jira_get_project_components', { projectKey: 'TEST' }],
  ['jira_get_project_versions', { projectKey: 'TEST' }],
  ['jira_get_fields', {}],
  ['jira_get_issue_types', { projectKey: 'TEST' }],
  ['jira_get_create_fields', { projectKey: 'TEST', issueType: 'Помилка' }],
  ['jira_get_priorities', {}],
  ['jira_get_link_types', {}],
  ['jira_search_users', { query: 'vova' }],
  ['jira_get_changelog', { issueKey: 'TEST-1' }],
  ['jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g' }],
  ['jira_bulk_create_issues', { issues: [{ summary: 'Bulk 1', description: 'One' }, { summary: 'Bulk 2', description: 'Two', issueType: 'Story' }] }],
  ['jira_clone_issue', { issueKey: 'TEST-1', summary: 'Cloned', customFields: { customfield_10500: 'qa' } }],
  ['jira_list_boards', {}],
  ['jira_list_sprints', { boardId: 1 }],
  ['jira_get_sprint', { sprintId: 10 }],
  ['jira_move_to_sprint', { sprintId: 10, issueKeys: ['TEST-1'] }],
  ['jira_get_attachments', { issueKey: 'TEST-1' }],
  ['jira_add_attachment', { issueKey: 'TEST-1', filePath: UPLOAD_PATH }],
  ['jira_list_epics', { projectKey: 'TEST' }],
  ['jira_get_epic', { epicKey: 'TEST-100' }],
  ['jira_get_epic_issues', { epicKey: 'TEST-100' }],
  ['jira_get_board_epics', { boardId: 1 }],
  ['jira_add_issues_to_epic', { epicKey: 'TEST-100', issueKeys: ['TEST-1'] }],
  ['jira_remove_issue_from_epic', { issueKeys: ['TEST-1'] }],
  ['jira_create_epic', { summary: 'New epic', description: 'Epic body' }],
  ['jira_get_myself', {}],
  ['jira_add_watcher', { issueKey: 'TEST-1', accountId: '5b10a2844c20165700ede21g' }],
  ['jira_remove_watcher', { issueKey: 'TEST-1', accountId: '5b10a2844c20165700ede21g' }],
  ['jira_get_watchers', { issueKey: 'TEST-1' }],
  ['jira_download_attachment', { attachmentId: '9001', savePath: DOWNLOAD_PATH }],
  ['jira_view_attachment', { attachmentId: '9001' }],
  ['jira_list_filters', {}],
  ['jira_get_filter', { filterId: '1000' }],
  ['jira_search_by_filter', { filterId: '1000' }],
  ['jira_bulk_transition_issues', { issueKeys: ['TEST-1'], transitionId: '21' }],
];

test('every registered tool has a contract case', async () => {
  const { tools } = await server.listTools();
  const covered = new Set(CASES.map(([, , canonical], i) => canonical ?? CASES[i][0]));
  const uncovered = tools.map(t => t.name).filter(name => !covered.has(name));
  assert.deepStrictEqual(uncovered, [], `Tools without a contract case: ${uncovered.join(', ')}`);
});

test('tools/list shape is stable regardless of declaration order', async () => {
  const { tools } = await server.listTools();
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length, 'tool names must be unique');
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  matchSnapshot('tools-list', sorted.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations ?? null,
    outputSchema: t.outputSchema ?? null,
  })));
});

test('prompts/list shape is stable', async () => {
  const { prompts } = await server.listPrompts();
  matchSnapshot('prompts-list', prompts);
});

test('server advertises its capabilities', async () => {
  matchSnapshot('initialize', server.initializeResult);
});

for (const [caseName, args, canonicalName] of CASES) {
  const toolName = canonicalName ?? caseName;
  test(`contract: ${caseName}`, async () => {
    const result = await server.call(toolName, args);
    matchSnapshot(`tool/${caseName}`, {
      isError: result.isError,
      data: result.data,
      contentTypes: result.content.map(c => c.type),
      requests: requestTrace(mock.requests),
    });
  });
}

test('stdout carries JSON-RPC only', () => {
  for (const line of server.stdoutLines) {
    assert.doesNotThrow(() => JSON.parse(line), `Non-JSON line on stdout would corrupt the stdio transport: ${line}`);
  }
});
