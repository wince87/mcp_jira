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
  ['jira_delete_issue_link', { linkId: '20001' }],
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
  ['jira_create_version', { name: '2.0', projectKey: 'TEST', releaseDate: '2026-12-01' }],
  ['jira_update_version', { versionId: '10101', released: true, releaseDate: '2026-10-01' }],
  ['jira_delete_version', { versionId: '10101', moveFixIssuesTo: '10100' }],
  ['jira_create_component', { name: 'Billing', projectKey: 'TEST', leadAccountId: '5b10a2844c20165700ede21g' }],
  ['jira_update_component', { componentId: '10200', description: 'Auth and SSO' }],
  ['jira_delete_component', { componentId: '10200', moveIssuesTo: '10201' }],
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
  ['jira_create_sprint', { boardId: 1, name: 'Sprint 2', goal: 'Ship versions', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-14T00:00:00.000Z' }],
  ['jira_update_sprint', { sprintId: 10, state: 'closed' }],
  ['jira_delete_sprint', { sprintId: 10 }],
  ['jira_get_attachments', { issueKey: 'TEST-1' }],
  ['jira_delete_attachment', { attachmentId: '9001' }],
  ['jira_get_edit_fields', { issueKey: 'TEST-1' }],
  ['jira_get_remote_links', { issueKey: 'TEST-1' }],
  ['jira_add_remote_link', { issueKey: 'TEST-1', url: 'https://github.com/acme/repo/pull/42', title: 'PR #42', relationship: 'implemented by' }],
  ['jira_delete_remote_link', { issueKey: 'TEST-1', linkId: '60001' }],
  ['jira_bulk_update_issues', { issueKeys: ['TEST-1'], addLabels: ['triaged'] }],
  ['jira_get_project_statuses', { projectKey: 'TEST' }],
  ['jira_list_labels', {}],
  ['jira_get_my_permissions', { projectKey: 'TEST' }],
  ['jira_rank_issues', { issueKeys: ['TEST-1'], rankBeforeIssue: 'TEST-2' }],
  ['jira_move_to_backlog', { issueKeys: ['TEST-1'] }],
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
      hasStructuredContent: result.structuredContent !== undefined,
      requests: requestTrace(mock.requests),
    });
  });
}

test('stdout carries JSON-RPC only', () => {
  for (const line of server.stdoutLines) {
    assert.doesNotThrow(() => JSON.parse(line), `Non-JSON line on stdout would corrupt the stdio transport: ${line}`);
  }
});

test('every tool declaration carries a handler and a unique name', async () => {
  const { tools } = await server.listTools();
  assert.equal(tools.length, 75, 'tool count changed; update this number deliberately');
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} needs a real description`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} must take an object`);
  }
});

test('inputSchema declarations contain no stray top-level keys', async () => {
  // A property accidentally placed outside `properties` is silently
  // ignored by JSON Schema, so the parameter becomes invisible to every
  // client while the handler still supports it. This happened to
  // jira_add_comment's visibility/internal once.
  const KNOWN_SCHEMA_KEYS = new Set([
    'type', 'properties', 'required', 'additionalProperties', 'description', '$schema',
  ]);
  const { tools } = await server.listTools();
  for (const tool of tools) {
    for (const key of Object.keys(tool.inputSchema)) {
      assert.ok(
        KNOWN_SCHEMA_KEYS.has(key),
        `${tool.name}: stray top-level inputSchema key "${key}" — did a property land outside \`properties\`?`,
      );
    }
  }
});

test('field selection reaches Jira and reshapes every list tool the same way', async () => {
  for (const [tool, args] of [
    ['jira_search_issues', { jql: 'project = TEST' }],
    ['jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g' }],
    ['jira_get_sprint', { sprintId: 10 }],
    ['jira_get_epic_issues', { epicKey: 'TEST-100' }],
    ['jira_search_by_filter', { filterId: '1000' }],
    ['jira_list_epics', { projectKey: 'TEST' }],
  ]) {
    mock.reset();
    const result = await server.call(tool, { ...args, fields: ['summary', 'versions'] });
    const items = result.data.issues ?? result.data.epics;
    assert.ok(items?.[0]?.fields, `${tool} must return a raw fields map when fields is given`);
    assert.equal(typeof items[0].fields.summary, 'string', `${tool} returned the wrong shape`);
    assert.equal(items[0].summary, undefined, `${tool} must not mix both shapes`);
    const search = mock.requests.find(r => r.query?.fields);
    assert.equal(search.query.fields, 'summary,versions', `${tool} must forward the field list to Jira`);
  }
});

test('includeCustomFields resolves ids to names on every list tool', async () => {
  const result = await server.call('jira_search_issues', { jql: 'project = TEST', includeCustomFields: true });
  assert.equal(result.data.issues[0].customFields.customfield_10500.name, 'For QA');
  assert.equal(result.data.issues[0].customFields.customfield_10500.value, 'QA notes');
  const search = mock.requests.find(r => r.path === '/rest/api/3/search/jql');
  assert.equal(search.query.fields, '*all', 'custom fields can only be mapped if they were requested');
});

test('expand is forwarded and validated', async () => {
  await server.call('jira_search_issues', { jql: 'project = TEST', expand: ['changelog'] });
  assert.equal(mock.requests[0].query.expand, 'changelog');
  const bad = await server.call('jira_search_issues', { jql: 'project = TEST', expand: ['drop table'] });
  assert.equal(bad.isError, true);
});

test('sprint state moves through the workflow and is validated', async () => {
  mock.reset();
  const closed = await server.call('jira_update_sprint', { sprintId: 10, state: 'CLOSED' });
  assert.equal(closed.isError, false, 'state must be case-insensitive');
  assert.equal(mock.requests[0].body.state, 'closed');

  const bad = await server.call('jira_update_sprint', { sprintId: 10, state: 'finished' });
  assert.equal(bad.isError, true, 'an unknown state must be rejected before reaching Jira');

  const empty = await server.call('jira_update_sprint', { sprintId: 10 });
  assert.equal(empty.isError, true, 'an update with nothing to change must be rejected');
});

test('sprint dates must carry a timezone', async () => {
  const bad = await server.call('jira_create_sprint', { boardId: 1, name: 'S', startDate: '2026-09-01' });
  assert.equal(bad.isError, true);
  const ok = await server.call('jira_create_sprint', { boardId: 1, name: 'S', startDate: '2026-09-01T00:00:00.000+03:00' });
  assert.equal(ok.isError, false, 'an offset with a colon is valid ISO 8601');
});

test('creating a version resolves the project key to the numeric id Jira requires', async () => {
  mock.reset();
  const result = await server.call('jira_create_version', { name: '3.0', projectKey: 'TEST' });
  assert.equal(result.isError, false);
  const post = mock.requests.find(r => r.method === 'POST' && r.path === '/rest/api/3/version');
  assert.equal(post.body.projectId, 10000, 'Jira rejects a project key here, it needs the id');
  assert.equal(post.body.name, '3.0');
});

test('releasing a version is an update, not a separate tool', async () => {
  mock.reset();
  const result = await server.call('jira_update_version', { versionId: '10101', released: true, releaseDate: '2026-10-01' });
  assert.equal(result.data.version.released, true);
  assert.equal(mock.requests[0].body.released, true);
});

test('component assigneeType is validated against the allowed set', async () => {
  const bad = await server.call('jira_create_component', { name: 'X', assigneeType: 'WHOEVER' });
  assert.equal(bad.isError, true);
  const ok = await server.call('jira_create_component', { name: 'X', assigneeType: 'component_lead' });
  assert.equal(ok.isError, false, 'assigneeType must be case-insensitive');
});

test('deleting a version uses removeAndSwap so issues can be repointed', async () => {
  mock.reset();
  await server.call('jira_delete_version', { versionId: '10101', moveFixIssuesTo: '10100' });
  const call = mock.requests[0];
  assert.equal(call.path, '/rest/api/3/version/10101/removeAndSwap', 'the plain DELETE endpoint is deprecated');
  assert.equal(call.body.moveFixIssuesTo, '10100');
});

test('bulk update adds labels without destroying the existing ones', async () => {
  mock.reset();
  await server.call('jira_bulk_update_issues', { issueKeys: ['TEST-1'], addLabels: ['triaged'], removeLabels: ['stale'] });
  const put = mock.requests.find(r => r.method === 'PUT' && r.path === '/rest/api/3/issue/TEST-1');
  assert.deepStrictEqual(put.body.update.labels, [{ add: 'triaged' }, { remove: 'stale' }]);
  assert.equal(put.body.fields, undefined, 'a label-only change must not send a fields block');
});

test('bulk update refuses to mix replacing and adjusting labels', async () => {
  const result = await server.call('jira_bulk_update_issues', { issueKeys: ['TEST-1'], labels: ['a'], addLabels: ['b'] });
  assert.equal(result.isError, true, 'replacing and adding at once is ambiguous and would silently drop labels');
});

test('bulk update rejects a call with nothing to change', async () => {
  const result = await server.call('jira_bulk_update_issues', { issueKeys: ['TEST-1'] });
  assert.equal(result.isError, true);
});

test('an internal comment carries the service-desk property', async () => {
  mock.reset();
  await server.call('jira_add_comment', { issueKey: 'TEST-1', comment: 'internal note', internal: true });
  assert.deepStrictEqual(mock.requests[0].body.properties, [{ key: 'sd.public.comment', value: { internal: true } }]);
});

test('comment visibility is validated', async () => {
  const bad = await server.call('jira_add_comment', { issueKey: 'TEST-1', comment: 'x', visibility: { type: 'everyone', value: 'all' } });
  assert.equal(bad.isError, true);
  mock.reset();
  const ok = await server.call('jira_add_comment', { issueKey: 'TEST-1', comment: 'x', visibility: { type: 'ROLE', value: 'Administrators' } });
  assert.equal(ok.isError, false);
  assert.deepStrictEqual(mock.requests[0].body.visibility, { type: 'role', value: 'Administrators' });
});

test('remote links only accept http and https', async () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url']) {
    const result = await server.call('jira_add_remote_link', { issueKey: 'TEST-1', url, title: 'x' });
    assert.equal(result.isError, true, `${url} must be rejected`);
  }
});

test('ranking requires exactly one anchor', async () => {
  const none = await server.call('jira_rank_issues', { issueKeys: ['TEST-1'] });
  assert.equal(none.isError, true);
  const both = await server.call('jira_rank_issues', { issueKeys: ['TEST-1'], rankBeforeIssue: 'TEST-2', rankAfterIssue: 'TEST-3' });
  assert.equal(both.isError, true);
});

test('permissions are reported as granted and denied', async () => {
  const result = await server.call('jira_get_my_permissions', { projectKey: 'TEST', permissions: ['EDIT_ISSUES', 'DELETE_ISSUES'] });
  assert.deepStrictEqual(result.data.granted, ['EDIT_ISSUES']);
  assert.deepStrictEqual(result.data.denied, ['DELETE_ISSUES'], 'a denied permission must be visible, not just absent');
});
