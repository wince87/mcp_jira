# CLAUDE.md — mcp_jira internal notes

Internal context for Claude Code. Not published to npm.

## What this is

MCP server exposing Jira Cloud REST API v3 as 34 tools. Stdio transport, Node 18+. Single-file TypeScript source at [src/index.ts](src/index.ts). Published to npm as `@mcpio/jira`, consumed via `npx -y @mcpio/jira`.

## Architecture (single file, intentional)

[src/index.ts](src/index.ts) — ~1700 lines, split by region:

1. **Env loading** — minimal inline `.env` parser (no `dotenv` dep — see note below)
2. **Validation helpers** — `validateIssueKey`, `validateProjectKey`, `validateJQL`, `validateSafeParam`, `validateAccountId`, `validateISO8601`, `validateAttachmentPath`
3. **Types** — `JiraIssue`, `JiraComment`, `JiraWorklog`, etc. (internal, for response mapping)
4. **ADF conversion** — `createADFDocument` (Markdown→ADF), `adfToText` (ADF→Markdown). Bidirectional, supports headings, lists, blockquotes, code blocks, tables, rules, inline formatting.
5. **Axios clients** — `jiraApi` (`/rest/api/3`), `agileApi` (`/rest/agile/1.0`)
6. **Tool definitions** — `ListToolsRequestSchema` handler, all 34 tools with JSON schemas
7. **Handlers** — one function per tool, `handle<X>(a: ToolArgs)`. Dispatched via `toolHandlers` map.
8. **Error handling** — central `handleError` returns Jira error details.

**Why single file**: deliberate. Simplifies build, no module resolution surprises for `npx`, easier to audit.

## Release process (as of 2.3.11)

**Automated via GitHub Actions** — [.github/workflows/publish.yml](.github/workflows/publish.yml)

Trigger: push tag `v*` OR manual `workflow_dispatch`.

Steps for a release:
1. Bump version in three places (must match):
   - `package.json` (use `npm version patch --no-git-tag-version`)
   - `SERVER_VERSION` constant in [src/index.ts](src/index.ts)
   - `# Jira MCP Server vX.Y.Z` header in [README.md](README.md)
2. Add entry to [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format: Added/Fixed/Changed/Security)
3. Add one-line entry to README.md "Recent" section under Changelog
4. `npm run build` (verify clean)
5. `git add ... && git commit && git push origin main`
6. `gh release create vX.Y.Z --title "..." --notes "..."`
7. `git tag vX.Y.Z && git push origin vX.Y.Z` → **workflow auto-publishes with npm provenance**

**Do not** run `npm publish` locally anymore. All releases must flow through GitHub Actions so the tarball gets a sigstore OIDC attestation.

**NPM_TOKEN**: Classic Automation token stored as GitHub secret. Bypasses 2FA. Login session tokens (from `npm login`) do NOT work in CI — they're IP-bound.

## Dependency pinning policy

Post-axios-1.14.1 supply-chain attack (v2.3.10): **all runtime dependencies pinned to exact versions**, no `^` or `~` ranges.

Current pins:
- `axios`: `1.14.0` (NOT `1.14.1` — compromised, yanked)
- `@modelcontextprotocol/sdk`: `1.29.0` (minimum version to avoid 3 CVEs: GHSA-8r9q-7v3j-jr4g, GHSA-345p-7cg4-v4c7, GHSA-w48q-cv73-mx4w)

When bumping deps:
1. Read release notes + check `npm audit`
2. Prefer minor/patch updates; major bumps require manual verification
3. Update `package-lock.json` by running `rm -rf node_modules package-lock.json && npm install`
4. Document upgrade in CHANGELOG Security/Changed section

## Security invariants (do not regress)

These were fixed in v2.3.8 — do not undo:

- **`handleAddAttachment`**: file path MUST go through `validateAttachmentPath` (restricts to cwd + `$HOME`). A naive `absolutePath.startsWith('/')` check is useless on Unix.
- **`handleGetUserIssues`**: `projectKey` MUST be quoted in JQL (`project = "${projectKey}"`). `accountId` MUST go through `validateAccountId` (regex `^[a-zA-Z0-9:._-]{1,128}$`), not `sanitizeString`.
- **`handleAssignIssue`**: `accountId` MUST go through `validateAccountId`.
- **`handleAddWorklog`**: `started` MUST go through `validateISO8601`.
- **Path params used in URL** (`commentId`, `linkType`, `issueType`, `priority`): MUST go through `validateSafeParam` (blocks `/` and `\`).
- **JIRA_HOST**: MUST start with `https://` (enforced at startup).
- **Environment**: never log or echo tokens. `handleError` only surfaces Jira API error messages, never full request config.

## TypeScript conventions

- **No `any`.** Use `unknown`, typed interfaces, or `Record<string, unknown>`. Enforced since v2.3.8. CLAUDE.md global rule.
- Handler signature: `async function handle<X>(a: ToolArgs): Promise<ToolResponse>` where `ToolArgs = Record<string, unknown>`.
- Response mapping: always declare the intermediate array with a typed interface, e.g. `const issues: JiraIssue[] = response.data.issues ?? [];` — gives null safety AND type inference for `.map()`.
- Always null-guard `response.data.values`, `response.data.issues`, `response.data.comments`, etc. — Jira returns these inconsistently across endpoints.

## Known Jira API quirks (landmines)

- **`/search/jql`**: replaces removed `/search`. Does NOT return `total` anymore. Uses `nextPageToken` + `isLast`. Our response field is named `count` (not `total`) to reflect this.
- **`/issue/createmeta/{project}/issuetypes`**: returns `{ values: [...] }`, NOT `{ issueTypes: [...] }`.
- **`/priority/search`**: replaces deprecated `/priority`. Returns `{ values: [...] }`.
- **ADF**: description and comment bodies are Atlassian Document Format, NOT plain text or Markdown. Our `createADFDocument` converts Markdown → ADF on write, `adfToText` converts ADF → Markdown on read.
- **Story points field**: configurable via `JIRA_STORY_POINTS_FIELD` env (default `customfield_10016`). Different per Jira instance.
- **Link duplicate detection**: Jira error message is NOT stable — use substring/regex match, not exact equality.
- **Multipart upload for attachments**: needs `X-Atlassian-Token: no-check` header. Content-Type must be `multipart/form-data`, not `application/json`.

## Why no `dotenv` and no `.env` parsing at all

- **No `dotenv` package**: removed in v2.2.2. Reason: `dotenv@17+` prints `[dotenv@17.x.x] injecting env` to **stdout** on import. MCP stdio transport uses stdout for JSON-RPC — any non-JSON output corrupts the protocol.
- **No inline `.env` parser either**: removed in v2.3.12. Reason: `readFileSync('.env')` triggers Socket "filesystem capability" supply-chain alert, lowering the score. The server now reads config only from `process.env`. MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) pass env via `env: {...}` in subprocess spawn config — that goes directly into `process.env`, no file read needed. Users who want a `.env` file source it in their shell: `set -a; source .env; set +a; npx @mcpio/jira`. **Do not re-add file-based env loading.**

## Code style

- No comments in code (global rule).
- No emojis in code or docs.
- Terse over verbose.
- Single-file architecture — do not split unless there's a compelling reason.
- Error messages should be actionable and name the failing field.

## Files that matter

- [src/index.ts](src/index.ts) — everything
- [package.json](package.json) — exact version pins only
- [.github/workflows/publish.yml](.github/workflows/publish.yml) — release automation
- [CHANGELOG.md](CHANGELOG.md) — full version history
- [README.md](README.md) — user-facing docs (npm page)
- `dist/` — build output, gitignored, generated by `tsc`
- `index.js` — root shim (`#!/usr/bin/env node; import './dist/index.js'`) that `package.json` bin points to

## NPM package scope

`@mcpio/jira` — scoped, published as public. Single maintainer (`volodymyr-press`). Bus factor = 1 (known Socket score penalty, acceptable for now).
