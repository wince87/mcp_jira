# Migrating from 2.x to 3.0

Everything here is a change you can see from the outside. Tool names did not change and no
tool was removed, so a workflow that only calls tools by name keeps working. What changed is
the shape of some responses, and the runtime floor.

## 1. Node 20 or newer

`engines` moved from `>=18.0.0` to `>=20.0.0`. Node 18 reached end of life in April 2025.

If you run the server via `npx -y @mcpio/jira` from an MCP client, check the Node version that
client uses, not the one in your shell.

## 2. People are always `{accountId, displayName}`

In 2.x a person came back as a bare display name in some tools and as an object in others, so
callers had to remember which was which. Now every person is an object, and `null` when unset.

| Field | 2.x | 3.0 |
|-------|-----|-----|
| `assignee` in list results | `"Vova Press"` | `{ "accountId": "5b10...", "displayName": "Vova Press" }` |
| `reporter` in `jira_get_issue` | `"Vova Press"` | object |
| `author` in `jira_get_comments` | `"Vova Press"` | object |
| `author` in `jira_get_worklogs` | `"Vova Press"` | object |
| `author` in `jira_get_attachments` | `"Vova Press"` | object |
| `author` in `jira_get_changelog` | `"Vova Press"` | object |
| `lead` in `jira_get_project_info`, `jira_list_projects` | `"Vova Press"` | object |
| `lead` in `jira_get_project_components` | `"Vova Press"` | object |

```diff
- const name = issue.assignee;
+ const name = issue.assignee?.displayName;
+ const id   = issue.assignee?.accountId;   // now available without a second lookup
```

## 3. Pagination is one envelope everywhere

`count` and `isLast` are gone. Every list now reports how many items came back and whether
more exist.

| 2.x | 3.0 |
|-----|-----|
| `count: 25` | `returned: 25` |
| `isLast: false` | `hasMore: true` |
| `total` (sometimes the page size, sometimes the real total) | `total` only when Jira reports a real total |
| — | `startAt` on offset-paginated tools |
| `nextPageToken` | unchanged, on `/search/jql`-backed tools |

`returned` is deliberately not called `total`. Jira's `/search/jql` stopped reporting a real
total, and calling a page size `total` was the confusion the old `count` name existed to avoid.

```diff
- if (!result.isLast) fetchMore(result.nextPageToken);
+ if (result.hasMore) fetchMore(result.nextPageToken ?? { startAt: result.startAt + result.returned });
```

`startAt` is also now accepted as an argument by `jira_get_comments`, `jira_get_changelog`,
`jira_get_worklogs`, `jira_list_projects`, `jira_search_users`, `jira_list_filters`,
`jira_list_boards`, `jira_list_sprints`, `jira_get_sprint`, `jira_get_epic_issues` and
`jira_get_board_epics`. In 2.x those tools stopped at the first 100 rows with no way forward.

## 4. Issue list items have one shape

`jira_search_issues`, `jira_get_user_issues`, `jira_get_sprint`, `jira_get_epic_issues`,
`jira_search_by_filter` and `jira_list_epics` returned different subsets of fields. They now
return the same keys:

```
key, summary, status, statusCategory, assignee, priority, issueType,
parent, labels, storyPoints, created, updated, url
```

Nothing was dropped — every field any of them returned in 2.x is still there. Fields that only
some of them used to return are now present on all of them.

## 5. `jira_get_issue` returns more

Added: `statusCategory`, `resolution`, `components`, `versions`, `fixVersions`, `dueDate`,
`timetracking`, and `links` (issue links, which 2.x never returned even though the
`jira-dependency-map` prompt told the agent to read them from here).

Changed: `reporter` is an object (see §2), `parent` is `null` rather than absent when there is
no parent.

## 6. `jira_bulk_transition_issues` reports which transition ran

```diff
- "succeeded": ["PROJ-1", "PROJ-2"]
+ "succeeded": [
+   { "issueKey": "PROJ-1", "transition": "Start work (estimate)", "to": "In Progress" },
+   { "issueKey": "PROJ-2", "transition": "Start work (estimate)", "to": "In Progress" }
+ ]
```

The transition is resolved per issue, so which one actually ran can differ between issues.

That tool also changed behaviour: `status` (and the older `transitionName`) is matched against
each transition's **target status** first, then against transition names. In 2.x it only
matched transition names, so `"In Progress"` never found a transition called
`"Start work (estimate)"`. `transitionName` still works as an alias.

## 7. `labels` is only sent when you pass it

2.x sent `labels: []` on every create even when you did not ask for labels, which Jira rejects
on screens that do not expose the Labels field. Now omitted fields are omitted.

If you relied on create clearing labels, pass `labels: []` explicitly.

## 8. Localized Jira instances

`priority` and `issueType` accept an id or a name. A name is resolved to an id before sending,
matching against the create screen's allowed values and the project's priority list. In 2.x a
localized name (`"Високий"`) was sent as-is and rejected by Jira.

`jira_get_priorities` now returns a `note` field reminding callers to pass the id.

Set `JIRA_FORCE_ENGLISH=true` to make Jira answer in English instead, which removes the
ambiguity at the source.

## 9. Smaller behaviour changes

- `jira_create_subtask` discovers the project's subtask issue type instead of hardcoding
  `"Subtask"`, so instances using `"Sub-task"` or a localized name now work. Pass `issueType`
  to override.
- `jira_create_epic` sends the classic Epic Name field only when the create screen has it.
  Team-managed projects rejected the create in 2.x.
- `jira_delete_issue` gained `deleteSubtasks`. Without it Jira refuses to delete an issue that
  has subtasks, which 2.x had no way to handle at all.
- `jira_add_comment` and `jira_update_comment` now return the resulting `comment` alongside the
  existing `message`. This is additive.
- Create tools return the created `issue` alongside `key` and `url`. Additive.

## 10. New in 3.0, nothing to change

- Structured output: every successful call also returns `structuredContent`, and 44 tools
  declare an `outputSchema`. The JSON text block is unchanged, so old clients see no difference.
- Tool annotations: 36 tools are marked read-only, so clients can stop asking for approval on
  every lookup.
- Prompt arguments and `completion/complete`.
- Resources: `jira://issue/{key}`, `jira://project/{key}`,
  `jira://project/{key}/create-fields/{issueType}`, `jira://filter/{id}`, `jira://my-open-issues`.
- Rate-limit handling: `429` is retried with backoff. Writes are never retried on `5xx`, only
  on `429`, because a write that returned `5xx` may already have been applied.
- 21 new tools: sprint, version and component lifecycle; `jira_get_edit_fields`;
  `jira_bulk_update_issues`; remote links; `jira_delete_attachment`; `jira_delete_issue_link`;
  project statuses; labels; permissions; ranking; backlog.

## Checklist

- [ ] Running on Node 20+
- [ ] Code reading `assignee`, `reporter`, `author` or `lead` uses `.displayName`
- [ ] Code checking `isLast` uses `hasMore`
- [ ] Code reading `count` uses `returned`
- [ ] Code reading `succeeded` from `jira_bulk_transition_issues` expects objects
- [ ] Any create that relied on labels being cleared now passes `labels: []`
