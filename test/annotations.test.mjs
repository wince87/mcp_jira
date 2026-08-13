import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '__snapshots__', 'tool');

let mock;
let server;
let tools;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url });
  tools = (await server.listTools()).tools;
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

function tracesFor(toolName) {
  return readdirSync(SNAPSHOT_DIR)
    .filter(file => file === `${toolName}.json` || file.startsWith(`${toolName}__`))
    .map(file => JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8')));
}

test('every tool declares annotations', () => {
  const missing = tools.filter(t => !t.annotations).map(t => t.name);
  assert.deepStrictEqual(missing, [], 'a tool without annotations makes clients prompt for read-only calls');
});

test('every tool declares all four hints explicitly', () => {
  for (const tool of tools) {
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof tool.annotations[hint], 'boolean', `${tool.name} is missing ${hint}`);
    }
  }
});

test('a read-only tool never issued a write in any recorded run', () => {
  const violations = [];
  for (const tool of tools.filter(t => t.annotations.readOnlyHint)) {
    for (const snapshot of tracesFor(tool.name)) {
      for (const request of snapshot.requests ?? []) {
        if (request.method !== 'GET') {
          violations.push(`${tool.name} issued ${request.method} ${request.path}`);
        }
      }
    }
  }
  assert.deepStrictEqual(violations, [], 'readOnlyHint must be provable from the recorded request traces');
});

test('a read-only tool is never marked destructive', () => {
  const contradictions = tools
    .filter(t => t.annotations.readOnlyHint && t.annotations.destructiveHint)
    .map(t => t.name);
  assert.deepStrictEqual(contradictions, []);
});

test('every delete tool is marked destructive and not read-only', () => {
  for (const tool of tools.filter(t => t.name.startsWith('jira_delete_'))) {
    assert.equal(tool.annotations.destructiveHint, true, `${tool.name} deletes data and must say so`);
    assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} cannot be read-only`);
  }
});

const WRITES_OUTSIDE_JIRA = new Set(['jira_download_attachment']);

test('a tool that only ever read is not left unmarked', () => {
  const violations = [];
  for (const tool of tools.filter(t => !t.annotations.readOnlyHint)) {
    if (WRITES_OUTSIDE_JIRA.has(tool.name)) continue;
    const traces = tracesFor(tool.name);
    if (traces.length === 0) continue;
    const wrote = traces.some(s => (s.requests ?? []).some(r => r.method !== 'GET'));
    if (!wrote) violations.push(tool.name);
  }
  assert.deepStrictEqual(violations, [], 'these tools only ever read in their recorded runs; either they are read-only or the coverage is missing a write case');
});

test('a tool that writes to the local disk is not called read-only', () => {
  for (const name of WRITES_OUTSIDE_JIRA) {
    const tool = tools.find(t => t.name === name);
    assert.ok(tool, `${name} no longer exists; drop it from WRITES_OUTSIDE_JIRA`);
    assert.equal(
      tool.annotations.readOnlyHint,
      false,
      `${name} only reads from Jira but writes a file to the user's disk, which is still modifying its environment`,
    );
  }
});

test('everything reaches an external system', () => {
  const local = tools.filter(t => t.annotations.openWorldHint !== true).map(t => t.name);
  assert.deepStrictEqual(local, [], 'every tool talks to Jira');
});
