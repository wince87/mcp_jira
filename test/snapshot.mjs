import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '__snapshots__');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

function load(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function save(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function normalize(value) {
  return JSON.parse(
    JSON.stringify(value).replace(/https:\\?\/\\?\/127\.0\.0\.1:\d+/g, 'https://jira.test'),
  );
}

export function matchSnapshot(name, rawValue) {
  const file = join(SNAPSHOT_DIR, `${name}.json`);
  const value = normalize(rawValue);
  const existing = load(file);

  if (existing === null || UPDATE) {
    save(file, value);
    return;
  }

  assert.deepStrictEqual(
    value,
    existing,
    `Snapshot "${name}" changed. If this is intentional, rerun with UPDATE_SNAPSHOTS=1 and review the diff.`,
  );
}

export function requestTrace(requests) {
  return requests.map(r => {
    const entry = { method: r.method, path: r.path };
    const query = { ...r.query };
    if (Object.keys(query).length > 0) entry.query = query;
    if (r.body !== null && r.body !== undefined) entry.body = r.body;
    return entry;
  });
}
