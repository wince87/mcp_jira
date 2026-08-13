import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';

const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const API_TOKEN = 'test-token';

let mock;
let server;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url });
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

beforeEach(() => mock.reset());

const MUTATING = new Set(['POST', 'PUT', 'DELETE']);

async function expectRejected(tool, args, reason) {
  const before = mock.requests.length;
  const result = await server.call(tool, args);
  const issued = mock.requests.slice(before);
  assert.equal(result.isError, true, `${reason}: expected the call to be rejected`);
  const writes = issued.filter(r => MUTATING.has(r.method));
  assert.deepStrictEqual(
    writes.map(r => `${r.method} ${r.path}`),
    [],
    `${reason}: rejected input must never reach a write endpoint`,
  );
  return result;
}

test('attachment upload path stays inside cwd or HOME', async () => {
  await expectRejected('jira_add_attachment', { issueKey: 'TEST-1', filePath: '/etc/passwd' }, 'path traversal on upload');
  await expectRejected('jira_add_attachment', { issueKey: 'TEST-1', filePath: '../../../../etc/passwd' }, 'relative traversal on upload');
});

test('attachment download path stays inside cwd or HOME', async () => {
  await expectRejected('jira_download_attachment', { attachmentId: '9001', savePath: '/etc/cron.d/pwn' }, 'path traversal on download');
});

test('accountId is validated before reaching JQL or the API', async () => {
  await expectRejected('jira_get_user_issues', { accountId: '" OR 1=1 --' }, 'JQL injection via accountId');
  await expectRejected('jira_assign_issue', { issueKey: 'TEST-1', accountId: 'a b/../c' }, 'assignee accountId');
  await expectRejected('jira_add_watcher', { issueKey: 'TEST-1', accountId: 'bad id!' }, 'watcher accountId');
  await expectRejected('jira_remove_watcher', { issueKey: 'TEST-1', accountId: 'bad id!' }, 'watcher removal accountId');
});

test('projectKey is quoted inside generated JQL', async () => {
  await server.call('jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g', projectKey: 'TEST' });
  const search = mock.requests.find(r => r.path === '/rest/api/3/search/jql');
  assert.ok(search, 'expected a JQL search request');
  assert.match(search.query.jql, /project = "TEST"/, 'projectKey must be quoted in JQL');
});

test('status filter cannot break out of the JQL string', async () => {
  await server.call('jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g', status: 'To Do" OR "x"="x' });
  const search = mock.requests.find(r => r.path === '/rest/api/3/search/jql');
  assert.ok(search, 'expected a JQL search request');
  assert.ok(!/OR "x"="x"/.test(search.query.jql.replace(/\\"/g, '')), 'quotes in status must be escaped');
});

test('a trailing backslash cannot escape the closing JQL quote', async () => {
  await server.call('jira_get_user_issues', { accountId: '5b10a2844c20165700ede21g', status: 'Done\\' });
  const search = mock.requests.find(r => r.path === '/rest/api/3/search/jql');
  assert.ok(search, 'expected a JQL search request');
  assert.match(search.query.jql, /status = "Done\\\\"/, 'a backslash must be escaped before the quote, not left to escape it');
});

test('worklog start time must be ISO 8601 with offset', async () => {
  await expectRejected('jira_add_worklog', { issueKey: 'TEST-1', timeSpent: '1h', started: '2026-08-01' }, 'loose date');
  await expectRejected('jira_add_worklog', { issueKey: 'TEST-1', timeSpent: '1h', started: '2026-08-01T09:00:00Z' }, 'Z-terminated ISO');
});

test('path parameters reject slashes', async () => {
  const traversal = '../../admin';
  await expectRejected('jira_delete_comment', { issueKey: 'TEST-1', commentId: traversal }, 'commentId');
  await expectRejected('jira_update_comment', { issueKey: 'TEST-1', commentId: traversal, comment: 'x' }, 'commentId on update');
  await expectRejected('jira_delete_worklog', { issueKey: 'TEST-1', worklogId: traversal }, 'worklogId');
  await expectRejected('jira_get_filter', { filterId: traversal }, 'filterId');
  await expectRejected('jira_download_attachment', { attachmentId: traversal, savePath: 'x.png' }, 'attachmentId');
  await expectRejected('jira_view_attachment', { attachmentId: traversal }, 'attachmentId on view');
  await expectRejected('jira_link_issues', { inwardIssue: 'TEST-1', outwardIssue: 'TEST-2', linkType: traversal }, 'linkType');
  await expectRejected('jira_create_issue', { summary: 's', description: 'd', issueType: traversal }, 'issueType');
});

test('issue and project keys are validated', async () => {
  await expectRejected('jira_get_issue', { issueKey: 'not a key' }, 'issue key format');
  await expectRejected('jira_get_issue', { issueKey: '../../etc/passwd' }, 'issue key traversal');
  await expectRejected('jira_get_project_info', { projectKey: 'lower-case' }, 'project key format');
});

test('customFields cannot overwrite system fields', async () => {
  await expectRejected('jira_create_issue', { summary: 's', description: 'd', customFields: { summary: 'hijacked' } }, 'system field via customFields');
  await expectRejected('jira_create_issue', { summary: 's', description: 'd', customFields: { project: { key: 'OTHER' } } }, 'project via customFields');
});

test('error responses never leak the API token', async () => {
  const result = await server.call('jira_get_issue', { issueKey: 'MISSING-1' });
  const serialized = JSON.stringify(result);
  assert.equal(result.isError, true);
  assert.ok(!serialized.includes(API_TOKEN), 'API token must not appear in an error response');
  assert.ok(!serialized.toLowerCase().includes('authorization'), 'request headers must not appear in an error response');
});

test('server refuses to start without HTTPS', async () => {
  const child = spawn('node', [SERVER_ENTRY], {
    env: {
      PATH: process.env.PATH,
      JIRA_HOST: 'http://insecure.example.com',
      JIRA_EMAIL: 'test@example.com',
      JIRA_API_TOKEN: API_TOKEN,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.notEqual(code, 0, 'server must exit non-zero on plaintext JIRA_HOST');
  assert.match(stderr, /HTTPS/i);
});

test('server refuses to start without required credentials', async () => {
  const child = spawn('node', [SERVER_ENTRY], {
    env: { PATH: process.env.PATH, JIRA_HOST: 'https://example.atlassian.net' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.notEqual(code, 0, 'server must exit non-zero without JIRA_EMAIL');
  assert.match(stderr, /JIRA_EMAIL/);
});
