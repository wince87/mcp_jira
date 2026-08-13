import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMock } from './mock-jira.mjs';
import { startServer } from './client.mjs';

let mock;
let server;
let tools;
let promptTexts;

before(async () => {
  mock = await startMock();
  server = await startServer({ url: mock.url });
  tools = (await server.listTools()).tools;
  const { prompts } = await server.listPrompts();
  promptTexts = await Promise.all(prompts.map(async (prompt) => {
    const args = Object.fromEntries((prompt.arguments ?? []).map(arg => [arg.name, 'PLACEHOLDER-1']));
    const result = await server.request('prompts/get', { name: prompt.name, arguments: args });
    return { name: prompt.name, text: result.result.messages[0].content.text };
  }));
});

after(async () => {
  server?.stop();
  await mock?.stop();
});

test('every tool is referenced by at least one prompt', () => {
  const corpus = promptTexts.map(p => p.text).join('\n');
  const orphans = tools.map(t => t.name).filter(name => !corpus.includes(name));
  assert.deepStrictEqual(orphans, [], 'the README claims every tool appears in a prompt; these do not');
});

test('prompts never reference a tool that does not exist', () => {
  const known = new Set(tools.map(t => t.name));
  const unknown = new Set();
  for (const { text } of promptTexts) {
    for (const match of text.matchAll(/\bjira_[a-z_]+\b/g)) {
      if (!known.has(match[0])) unknown.add(match[0]);
    }
  }
  assert.deepStrictEqual([...unknown], [], 'a prompt pointing at a tool that does not exist sends the agent down a dead end');
});

test('prompts do not describe response fields that 3.0 removed', () => {
  const stale = [];
  for (const { name, text } of promptTexts) {
    for (const pattern of [/\bisLast\b/, /\bcount:\s/, /returns\s+total\b/]) {
      if (pattern.test(text)) stale.push(`${name}: ${pattern}`);
    }
  }
  assert.deepStrictEqual(stale, [], 'pagination fields changed in 3.0; prompts must not teach the old ones');
});

test('every prompt renders to non-trivial guidance', () => {
  for (const { name, text } of promptTexts) {
    assert.ok(text.length > 200, `${name} renders to ${text.length} characters, which is not a workflow`);
  }
});
