import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

export async function startServer({ url, env = {} } = {}) {
  const child = spawn('node', [SERVER_ENTRY], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      JIRA_HOST: url,
      JIRA_EMAIL: 'test@example.com',
      JIRA_API_TOKEN: 'test-token',
      JIRA_PROJECT_KEY: 'TEST',
      JIRA_STORY_POINTS_FIELD: 'customfield_10016',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));

  const pending = new Map();
  const stdoutLines = [];
  let buffer = '';

  child.stdout.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      stdoutLines.push(line);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    }
  });

  let nextId = 1;
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr.join('')}`));
      }, 15000);
      pending.set(id, message => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'contract-tests', version: '1' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  return {
    initializeResult: init.result,
    request,
    async listTools() {
      return (await request('tools/list', {})).result;
    },
    async listPrompts() {
      return (await request('prompts/list', {})).result;
    },
    async getPrompt(name) {
      return (await request('prompts/get', { name })).result;
    },
    async call(name, args = {}) {
      const response = await request('tools/call', { name, arguments: args });
      if (response.error) {
        return { protocolError: response.error, isError: true, data: null };
      }
      const result = response.result;
      const text = result?.content?.find(c => c.type === 'text')?.text;
      let data = null;
      if (text !== undefined) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return {
        isError: result?.isError === true,
        data,
        content: result?.content ?? [],
        structuredContent: result?.structuredContent,
      };
    },
    stdoutLines,
    stderr,
    stop() {
      child.kill();
    },
  };
}
