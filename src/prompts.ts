export interface PromptDef {
  description: string;
  text: string;
}

export const PROMPTS: Record<string, PromptDef> = {
  'jira-formatting-guide': {
    description: 'Markdown formatting rules for Jira descriptions and comments (auto-converted to ADF).',
    text: `This MCP server automatically converts Markdown to Atlassian Document Format (ADF).

Use standard Markdown:

Headings: # H1, ## H2, ### H3, #### H4, ##### H5, ###### H6
Bold: **bold text**
Italic: *italic text*
Strikethrough: ~~deleted text~~
Inline code: \`code\`
Links: [text](url)
Bullet lists: - item
Numbered lists: 1. item
Blockquotes: > text
Code blocks: \`\`\`language ... \`\`\`
Horizontal rule: ---

Images (must be on their own line):
- Attachment already on the issue: ![alt](media:<attachmentId>) - get the id from jira_get_attachments, or upload first with jira_add_attachment.
- External image URL: ![alt](https://...)

When referencing Jira issues, always use clickable links:
[PROJ-123](<browse-url>)`,
  },
  'jira-bug-triage': {
    description: 'Workflow guide for triaging open bugs (assign, prioritize, comment).',
    text: `Workflow for triaging open bugs in Jira.

Step 1 - Find untriaged bugs:
Call jira_search_issues with JQL like:
  project = "<KEY>" AND issuetype = Bug AND status = "To Do" AND assignee is EMPTY

Step 2 - For each bug, gather context:
- jira_get_issue to read description and recent comments
- jira_get_changelog if history matters
- jira_search_issues for similar/duplicate bugs (by keywords)

Step 3 - Set priority (use jira_update_issue with priority field):
- Highest: production down, data loss, security
- High: major feature broken, many users affected
- Medium: broken for some users, workaround exists
- Low: edge case, cosmetic
- Lowest: minor polish

Pass the priority id from jira_get_priorities, not the displayed name - names are localized on non-English instances and Jira rejects them.

Step 4 - Assign:
- Find owner: jira_search_users by component/team
- jira_assign_issue with accountId

Step 5 - Record rationale:
- jira_add_comment explaining priority and assignment

Never guess accountId or priority enum values - call jira_search_users / jira_get_priorities first if unsure.`,
  },
  'jira-sprint-summary': {
    description: 'Generate a status report for the current active sprint.',
    text: `Generate a status report for the active sprint.

Step 1 - Find the active sprint:
- jira_list_boards (pick the right project board)
- jira_list_sprints with state="active"
- If multiple, ask the user which one

Step 2 - Get sprint contents:
- jira_get_sprint (returns all issues with status, assignee, story points)

Step 3 - Classify issues into:
- Done (status category = done)
- In Progress (status category = indeterminate)
- To Do (status category = new)
- Blocked (label "blocked", or "is blocked by" link present)

Step 4 - For blocked issues, resolve the blocker:
- Inspect issue links via jira_get_issue
- Note who/what blocks each blocked item

Step 5 - Compose Markdown report:
## <Sprint name> - <dates>
- Completed: X / Y issues, A / B story points
- In Progress: list with assignee
- Blocked: list with blocker reason
- Risks: items unassigned or untouched for > 3 days

Always include clickable links [PROJ-XXX](<url>) for every referenced issue.`,
  },
  'jira-epic-breakdown': {
    description: 'Break a product idea into a new epic with child stories and subtasks.',
    text: `Break a product idea into an epic with structured child work.

Step 1 - Create the epic:
- jira_create_epic with summary and description (user intent, success criteria)

Step 2 - Identify major pieces of work (stories):
Typical slices: API / DB / UI / tests / docs / ops
Before the first create on an unfamiliar project, call jira_get_create_fields(projectKey, issueType) once - it lists which fields the screen requires and which values they accept, so no create fails on a mandatory field.
For each piece call jira_create_issue with:
  issueType: "Story"
  parent: <epic_key>
  summary: <verb-first, outcome-focused>
  description: acceptance criteria as markdown checklist

Step 3 - Add subtasks only where the story is > 1 day of work:
- jira_create_subtask with concrete implementation steps (typed, numbered)

Step 4 - Map dependencies:
- jira_link_issues with linkType "Blocks" or "Is blocked by"
- linkType list via jira_get_link_types (run once if unsure)

Step 5 - Return tree summary:
EPIC-<n>: <summary>
  STORY-<n>: <summary> [points]
    SUBTASK-<n>: ...
  ...

Never invent issueType or linkType names; fetch them if uncertain.`,
  },
  'jira-standup-prep': {
    description: 'Prepare standup notes (Yesterday / Today / Blockers) for the authenticated user.',
    text: `Prepare standup notes for the current user.

Step 1 - Identify "me":
- jira_get_myself -> use accountId

Step 2 - Yesterday (what I finished or worked on):
- jira_get_user_issues for accountId
  Filter client-side by updated within last ~24h
- For status transitions, use jira_get_changelog on key issues
- List completed and in-progress work

Step 3 - Today (what I plan to do):
- From same list, pick status = "In Progress" or next "To Do" by priority
- If nothing in progress, pick highest-priority unstarted
- Call out items with due date today/tomorrow

Step 4 - Blockers:
- Flag any issue with label "blocked" or with "is blocked by" incoming link
- For each blocker, name the blocking issue (and owner if assigned)

Step 5 - Format:
**Yesterday**
- [KEY-1](<url>) - summary (status changes)
- ...

**Today**
- [KEY-2](<url>) - summary (plan)

**Blockers**
- [KEY-3](<url>) blocked by [KEY-99](<url>) (<owner>) - reason

Keep it under ~10 bullets per section. Prefer outcomes over activity.`,
  },
  'jira-dependency-map': {
    description: 'Trace all blockers (direct and transitive) for an issue or epic.',
    text: `Map out what is blocking a target issue or epic, recursively.

Step 1 - Load the starting point:
- jira_get_issue for the target key
- Record its status, assignee, summary

Step 2 - Find direct blockers (issues that block the target):
- jira_get_issue returns issuelinks
- Filter for linkType where inward = "is blocked by" or "Blocks" (outward direction on the current issue)
- Collect the blocker keys

Step 3 - Recurse (max depth 3):
- For each blocker, run Step 1 + 2
- Track visited keys to avoid cycles
- Stop descending once status category = done

Step 4 - Surface risks:
- Blockers that are themselves blocked (chain length >= 2)
- Blockers unassigned
- Blockers without activity (no jira_get_changelog entries) in the last 14 days
- Blockers in a different project (cross-team dependency)

Step 5 - Format as an indented tree:
- [TARGET-1](<url>) Status, assignee
  - blocked by [KEY-A](<url>) Status, assignee
    - blocked by [KEY-B](<url>) Status, assignee  <- RISK: stale 30 days
  - blocked by [KEY-C](<url>) Status, UNASSIGNED  <- RISK

End with a one-sentence summary: "<target> is blocked by <n> direct and <m> transitive issues. Critical path: <chain>."`,
  },
  'jira-release-notes': {
    description: 'Generate release notes from issues resolved in a fixVersion.',
    text: `Generate release notes for a Jira version.

Step 1 - Identify the version:
- If user gave a version name, use it
- Else list project versions: jira_get_project_versions, pick latest unreleased (or user-specified)

Step 2 - Fetch issues resolved in that version:
- jira_search_issues with JQL:
  project = "<KEY>" AND fixVersion = "<NAME>" AND statusCategory = Done
- For each issue: jira_get_issue to pull description and issuetype

Step 3 - Group and sort:
- Features: issuetype in (Story, Task, Epic) AND labels include "feature" OR issuetype = Story
- Bug fixes: issuetype = Bug
- Improvements: everything else Done (Chore, Tech Debt, etc.)
- Within a group, sort by priority (Highest first)

Step 4 - Compose user-facing Markdown:
# <Project> <Version> - <release date>

## Highlights
<one paragraph, 2-3 sentences, written for end-users>

## New features
- [KEY-1](<url>) - Summary (rephrased as user benefit)

## Bug fixes
- [KEY-2](<url>) - Short description of what was broken

## Improvements
- [KEY-3](<url>) - Short description

## Contributors
- <Displayname> (<n> issues)
- ...

Rephrase technical summaries into user language. Keep each bullet under 120 chars.`,
  },
  'jira-velocity-check': {
    description: 'Analyze team velocity over the last N completed sprints.',
    text: `Analyze team velocity across recent sprints.

Step 1 - Pick the board:
- jira_list_boards, ask user or use project default

Step 2 - List completed sprints:
- jira_list_sprints with state="closed"
- Take the last 5 (or N specified by user)

Step 3 - For each sprint, compute:
- Committed points: sum of story points on issues present at sprint start
  (approximation: sum current story points on all sprint issues - note that scope can change mid-sprint)
- Completed points: sum of story points on issues with statusCategory = done at sprint end
- Completion rate: completed / committed
- Issue count: total issues, split by done / carried over

Data sources:
- jira_get_sprint returns issue list with story points
- For scope changes: jira_get_changelog on each issue, looking at Sprint field transitions (advanced, optional)

Step 4 - Surface patterns:
- Average velocity (mean completed points)
- Consistency (stddev / mean)
- Trend (slope of last 5 sprints - improving, flat, declining)
- Outlier sprints (>20% deviation from mean) and likely cause (vacation, incident, scope change)

Step 5 - Recommended commit for next sprint:
- Conservative: avg - 1 stddev
- Realistic: avg
- Stretch: avg + 1 stddev

Format as Markdown table + narrative summary at the end. Use clickable sprint links where possible.`,
  },
  'jira-workload-balance': {
    description: 'Snapshot current workload per assignee to detect overload.',
    text: `Snapshot who is working on what, right now.

Step 1 - Scope:
- Project key (default or user-provided)
- Optional: restrict to specific sprint via jira_get_sprint, or JQL filter

Step 2 - Pull active work:
- jira_search_issues with JQL:
  project = "<KEY>" AND statusCategory != Done AND assignee is not EMPTY
- Fields needed: summary, assignee, status, priority, storyPoints, issuetype

Step 3 - Group by assignee:
For each assignee compute:
- In-progress count and points (statusCategory = indeterminate)
- To-do count and points (statusCategory = new)
- Highest priority of active work
- Any overdue items (duedate < today)

Step 4 - Identify risks:
- Over-assigned: >2 issues in progress simultaneously (context-switching penalty)
- Under-utilized: 0 in progress, 0 to-do
- Blocker bottleneck: assignee of a blocker mentioned by jira-dependency-map
- Single-point-of-failure: only person working on a given epic/component

Step 5 - Format:
## <Project> Workload Snapshot - <date>

| Assignee | In Progress | To Do | Points (active) | Highest priority | Risk |
|----------|-------------|-------|-----------------|------------------|------|
| Alice    | 3 [links]   | 5     | 18              | Highest          | Context switch |
| Bob      | 1           | 2     | 5               | Medium           | - |

Narrative at the end: 1-2 sentences on recommended rebalancing.`,
  },
  'jira-changelog-audit': {
    description: 'Audit history of an issue - who changed what, when, and why.',
    text: `Audit the change history of a specific issue.

Step 1 - Load context:
- jira_get_issue for current state
- jira_get_changelog for full history

Step 2 - For each change entry, extract:
- When (created timestamp)
- Who (author displayName + accountId)
- Field changed (status / assignee / priority / labels / links / description / custom)
- From -> To values

Step 3 - Classify activity:
- Lifecycle transitions: status changes (To Do -> In Progress -> Done)
- Ownership changes: assignee reassignments
- Scope changes: summary edited, story points revised, labels added/removed, description rewritten
- Metadata: priority, fixVersion, components

Step 4 - Surface anomalies:
- Rapid reassignments (>3 different assignees in <7 days - hot potato)
- Back-and-forth status (Done -> In Progress reopen counts)
- Silent edits on active issue (description rewritten during In Progress without a linked comment)
- Scope creep signal (summary or story points changed after work started)

Step 5 - Format:
## History of [KEY](<url>)
### Timeline
- <date> by <name>: <field> "<from>" -> "<to>"
...

### Signals
- <observation with impact>

Keep to the most relevant 15-20 entries if history is long.`,
  },
  'jira-user-lookup': {
    description: 'Resolve accountId for a person by partial name or email.',
    text: `Find a user's accountId in Jira - required by assignment, watcher, and user-issue tools.

Step 1 - Accept input forms:
- Partial name: "alice smith"
- Email: "alice@company.com"
- Both

Step 2 - Search:
- jira_search_users with the query
- Returns list of active users matching display name or email

Step 3 - Disambiguate:
- If exactly one match -> return accountId
- If multiple -> present list as Markdown with displayName, email, accountType, active flag
- If zero -> broaden search (first name only, domain only) and retry once
- If still zero, state so explicitly - do NOT invent an accountId

Step 4 - Validate candidate:
- Optional: call jira_get_user_issues on a match to check they actually have project activity (confirms the right person)

Step 5 - Return in this exact shape:
accountId: <opaque string>
displayName: <name>
email: <email>
accountType: atlassian | app | customer

Never pass displayName or email to jira_assign_issue - always resolve to accountId first.`,
  },
  'jira-sprint-planning': {
    description: 'Pull candidates from backlog into the next sprint based on priority and capacity.',
    text: `Plan the next sprint from the backlog.

Step 1 - Find target sprint:
- jira_list_boards for the project
- jira_list_sprints with state="future" (the upcoming planned sprint)
- If none exists, create it: jira_create_sprint with boardId, name and dates

Step 2 - Determine capacity:
- Use jira-velocity-check to get average completed points over last 5 sprints
- Default target commit = 0.9 * average velocity
- Account for OOO / holidays if user mentions any

Step 3 - Pull ranked backlog:
- jira_search_issues with JQL:
  project = "<KEY>" AND status = "To Do" AND sprint is EMPTY AND issuetype in (Story, Task, Bug)
  ORDER BY priority DESC, rank ASC
- Fields: summary, priority, storyPoints, labels, issuetype, epic link

Step 4 - Fill toward capacity:
- Top-down by rank + priority
- Skip any issue missing storyPoints (flag them for refinement)
- Skip any issue labeled "blocked" or with active "is blocked by" link
- Stop once cumulative points reaches target

Step 5 - Move to sprint:
- jira_move_to_sprint with the chosen issueKeys (confirm with user first if >10)

Step 6 - Report:
## Sprint <name> plan
Target capacity: <X> points (based on <N> prior sprints, avg <Y>)
Selected: <M> issues, <P> points committed
- [KEY](<url>) - summary, <points>p, priority, epic
...

Skipped (needs refinement):
- [KEY](<url>) - missing story points
...`,
  },
  'jira-version-planning': {
    description: 'Assign issues to a fixVersion (release) based on scope and priority.',
    text: `Plan the contents of an upcoming release version.

Step 1 - Identify the version:
- jira_get_project_versions; pick one unreleased and undated, or user-specified
- If the target version does not exist, create it: jira_create_version with name and releaseDate
- After the release ships, close it out: jira_update_version with released=true

Step 2 - Discover candidates:
- jira_search_issues with JQL:
  project = "<KEY>" AND fixVersion is EMPTY AND status != Done AND issuetype in (Story, Bug, Task)
  ORDER BY priority DESC

Step 3 - Bucket:
- MUST: priority Highest OR label "release-blocker"
- SHOULD: priority High, linked to committed epic
- COULD: priority Medium, fits timeline

Step 4 - Verify capacity fit:
- Sum story points in MUST bucket vs remaining capacity until release date
- If MUST exceeds capacity, flag as overcommit risk

Step 5 - Propose assignments:
For each issue to include: jira_update_issue with fixVersions: ["<version name or id>"]

Step 6 - Report plan:
## <Version> plan - target <date>
Capacity: <calculated>
MUST include (<N>p):
- [KEY](<url>)
SHOULD include (<N>p):
- [KEY](<url>)
COULD include (<N>p):
- [KEY](<url>)
Risks: <overcommit / blocker dependency / missing scope>`,
  },
  'jira-clone-template': {
    description: 'Create standardized work by cloning a template issue (onboarding, checklists, recurring tasks).',
    text: `Create a new issue from a template (saved as a reference issue in Jira).

Step 1 - Find the template:
- User names it ("onboarding template") or gives the key directly
- jira_search_issues with JQL:
  project = "<KEY>" AND labels = "template" AND summary ~ "<name>"
- Confirm match: jira_get_issue

Step 2 - Customize the clone:
- New summary (usually template summary + specific context: "Onboarding: <NewHire name>")
- Replace placeholders in description (<NAME>, <DATE>, <TEAM>) with concrete values
- Target assignee (new hire, project owner, etc.)
- Target project if cloning cross-project

Step 3 - Clone:
- jira_clone_issue with templateKey, new summary, optional targetProject
- Returns new issue key

Step 4 - Clone child subtasks if template has them:
- jira_get_issue on template - read subtask list
- For each subtask: jira_create_subtask on the new issue with the same summary (and customized description)

Step 5 - Post-clone setup:
- jira_assign_issue to the target user
- jira_add_watcher for stakeholders (manager, buddy)
- jira_add_comment: "Cloned from template [TEMPLATE-KEY](<url>)"

Step 6 - Report:
Created [NEW-KEY](<url>) from template [TEMPLATE-KEY](<url>)
Subtasks: <N> created
Watchers: <list>
Assigned to: <name>`,
  },
  'jira-subtask-breakdown': {
    description: 'Split a story or task into concrete subtasks with acceptance criteria.',
    text: `Break a parent story/task into implementation subtasks.

Step 1 - Understand the parent:
- jira_get_issue for the parent key
- Read summary, description, acceptance criteria
- Read comments for any later clarifications

Step 2 - Identify natural splits. Ask yourself:
- Is there a data model change? -> Backend schema subtask
- Is there an API change? -> Endpoint implementation subtask
- Is there UI work? -> Frontend subtask
- Are there tests required? -> Test coverage subtask
- Are there docs/migrations/ops? -> Separate subtasks

Aim for subtasks sized 0.5-2 days each. If a subtask seems bigger, split further.

Step 3 - Draft subtask list:
Each subtask:
- Summary: verb-first action ("Add POST /orders endpoint", "Write migration for orders.total column")
- Description: acceptance criteria as Markdown checklist:
  - [ ] Endpoint responds 201 with full body
  - [ ] Input validated with zod schema
  - [ ] Integration test covers happy path

Step 4 - Create subtasks:
- jira_create_subtask for each, parent = target issueKey
- Set priority same as parent (or bump highest-priority item to match)

Step 5 - Link dependencies between subtasks (if any):
- jira_link_issues with type "Blocks" / "is blocked by"
  e.g. migration blocks endpoint, endpoint blocks UI

Step 6 - Report tree:
## [PARENT](<url>) breakdown
- [SUB-1](<url>) - Backend schema (0.5d)
- [SUB-2](<url>) - API endpoint (1d, blocked by SUB-1)
- [SUB-3](<url>) - UI integration (1d, blocked by SUB-2)
- [SUB-4](<url>) - Test coverage (0.5d, parallel)

Total: ~3 days, 4 subtasks`,
  },
  'jira-backlog-grooming': {
    description: 'Find stale, ambiguous, or low-quality backlog items that need attention.',
    text: `Groom the backlog - surface issues that are stale, unclear, or duplicative.

Step 1 - Pull entire backlog:
- jira_search_issues with JQL:
  project = "<KEY>" AND status = "To Do" AND sprint is EMPTY

Step 2 - Apply quality signals:

2a. Stale (no activity):
- jira_get_changelog per issue; flag if no changes in >90 days AND no comments in >90 days
- For large backlogs, check just updated field as cheap proxy

2b. Unclear / minimal description:
- description is empty, shorter than 50 chars, or just restates the summary
- No acceptance criteria / checklist

2c. Unestimated:
- storyPoints is null for items older than 30 days

2d. Unprioritized:
- priority is unset or still the instance default (commonly Medium) AND age >60 days (likely never reviewed)

2e. Orphaned:
- Has no epic link and is not itself an Epic

2f. Possible duplicates:
- Similar summary substring to another backlog item (use naive word-overlap heuristic)
- If two candidates found, use jira-duplicate-detector for deeper check

Step 3 - Propose actions:
For each flagged issue, suggest:
- Stale + unassigned + no comments -> close (resolution: Won't Do)
- Unclear description -> comment asking reporter for acceptance criteria
- Unestimated -> mark for next refinement session
- Duplicate -> link via "Duplicates" and close one

Step 4 - Report:
## Backlog grooming report (<N> issues reviewed)
### To close (<n>)
- [KEY](<url>) - reason (stale 180d, unassigned)

### Needs clarification (<n>)
- [KEY](<url>) - description too thin, asking author

### Needs estimation (<n>)
- [KEY](<url>)

### Possible duplicates (<n>)
- [KEY-A](<url>) vs [KEY-B](<url>) - similarity: <reason>

Recommend refinement session if total flagged >20.`,
  },
  'jira-duplicate-detector': {
    description: 'Find potential duplicates of a given issue in the project.',
    text: `Detect possible duplicates of a specific issue.

Step 1 - Load target:
- jira_get_issue for the reference key
- Extract: summary words, labels, component, reporter

Step 2 - Generate search queries (try multiple, unioning results):
Query A (exact phrase):
  project = "<KEY>" AND summary ~ "\\"<first 5 words of summary>\\"" AND key != <target>
Query B (keyword overlap):
  project = "<KEY>" AND summary ~ "<top 3 non-stopword nouns>"  AND key != <target>
Query C (same component):
  project = "<KEY>" AND component = "<target component>" AND status != Done AND key != <target>

Step 3 - Score candidates:
- Summary word overlap (Jaccard similarity) - weight 0.5
- Same reporter - weight 0.1
- Same labels - weight 0.15
- Same component - weight 0.15
- Same status category (both To Do) - weight 0.1

Flag threshold: total score >= 0.5 -> probable duplicate

Step 4 - For each probable duplicate:
- jira_get_issue to read description
- jira_get_comments to check if already discussed / dismissed as duplicate

Step 5 - Report:
## Duplicates of [TARGET](<url>)
### High confidence (<n>)
- [KEY](<url>) - similarity: <score>, reason: <overlap summary>, comment thread reviewed

### Worth checking (<n>)
- [KEY](<url>) - similarity: <score>, reason

If high-confidence match found, recommend:
- jira_link_issues with linkType "Duplicate"
- jira_add_comment on the duplicate pointing to the canonical issue
- Close the duplicate

Do NOT auto-close - always let user confirm duplicate decisions.`,
  },
  'jira-estimation-helper': {
    description: 'Estimate story points for a new issue based on similar completed issues.',
    text: `Estimate story points for a new issue by referencing similar completed work.

Step 1 - Load target:
- jira_get_issue for the unestimated key (or accept draft summary+description from user)
- Extract: issuetype, component, labels, key summary nouns

Step 2 - Find comparable completed work:
- jira_search_issues with JQL:
  project = "<KEY>" AND issuetype = "<target type>" AND status = Done AND "Story Points[Number]" is not EMPTY
  AND (summary ~ "<keyword1>" OR summary ~ "<keyword2>" OR component = "<target component>")
  ORDER BY updated DESC
- Fetch top ~20 most recent

Step 3 - Narrow to truly comparable (<=10):
- Exclude issues much bigger or smaller at first glance
- Prefer ones authored by same reporter or assigned to same assignee (consistency)
- Read jira_get_issue description to confirm similar scope

Step 4 - Compute:
- Distribution of story points in comparables (min, median, max, stddev)
- Mode is usually the safest baseline for ambiguous work

Step 5 - Adjust:
- Add 1 unit if target involves: cross-team dep, new tech, external vendor, ops/infra change
- Subtract 1 unit if target is: pure copy/paste of pattern, lots of existing test coverage

Step 6 - Report:
## Estimate for [TARGET](<url>)
Recommendation: <N> story points (<confidence: high/medium/low>)

### Reference issues
| Key | Summary | Points | Why comparable |
|-----|---------|--------|----------------|
| [K1](<url>) | ... | 3 | same component, similar scope |
| [K2](<url>) | ... | 5 | same pattern, different component |

### Adjustments
- +1 for <reason>
- -1 for <reason>

Suggest refinement with team if confidence=low.`,
  },
  'jira-retro-data': {
    description: 'Collect data for a sprint retrospective (wins, misses, flow issues).',
    text: `Collect structured data for a sprint retrospective.

Step 1 - Identify the sprint:
- jira_list_sprints state="closed", pick the most recent (or user-specified)
- jira_get_sprint to pull all issues with final status

Step 2 - Collect baseline metrics:
- Committed vs completed points (see jira-velocity-check)
- Carry-overs (issues still not Done at sprint end)
- Added-mid-sprint (use jira_get_changelog on each issue, look for Sprint-field changes)
- Removed-mid-sprint (same)

Step 3 - Per-issue data useful for retro:
For each issue:
- Cycle time: created -> Done (or started In Progress -> Done)
- Number of status flips (In Progress -> To Do reopens, Code Review rounds)
- Time in each status category (indeterminate = active work vs new = waiting)
- Blocker events: any "blocked" label added or "is blocked by" link created during the sprint
- Assignee changes during sprint

Step 4 - Classify:
Wins:
- Completed issues with short cycle time and no flips
- Unblocking fast (blocker resolved within 2 days)
- Over-delivery (completing more than committed)

Misses:
- Carry-overs and their reason (blocked, scope too big, unavailable person)
- Frequent-flip issues (signals unclear acceptance criteria)
- Long in-progress durations with little change

Flow issues:
- Scope added mid-sprint (>20% of original commit)
- Bugs spiked (inflow rate during sprint vs prior)

Step 5 - Output retro draft:
## Sprint <name> retro data
### Numbers
- Committed / Completed / Carry-over / Added mid-sprint

### What went well
- [KEY](<url>) - reason
...

### What did not go well
- [KEY](<url>) - reason (blocked X days, assignee rotation)
...

### Flow signals
- <observation>

### Discussion prompts
- "Why did [KEY] flip between statuses N times?"
- "Should we cap mid-sprint additions at X points?"

Keep to data. Let the team discuss root causes.`,
  },
  'jira-epic-health': {
    description: 'Traffic-light health check per active epic (progress, blockers, pace).',
    text: `Run a health check across all active epics.

Step 1 - Get epics:
- jira_list_epics with status filter excluding Done
  or jira_get_board_epics with done="false" for a specific board

Step 2 - For each epic:
- jira_get_epic for metadata
- jira_get_epic_issues for children (done count, inProgress count, total)

Step 3 - Compute health signals:

3a. Progress:
- % done = done / total
- For target date (if set): expected % at today vs actual

3b. Pace:
- Count of issues closed in last 14 days
- If count = 0 for >14 days and epic not Done -> stalled

3c. Scope churn:
- Issues added to epic in last 14 days (compare parent field changes via jira_get_changelog)

3d. Blockers:
- Any child with "blocked" label or "is blocked by" link
- Count and list them

3e. Ownership:
- Is there a consistent assignee on child issues or scattered across many people?
- Unassigned child count

Step 4 - Assign traffic light:
- Green: progress on track, no blockers, consistent pace
- Yellow: one or two risk signals (slow pace OR scope churn OR 1-2 blockers)
- Red: multiple risks OR stalled >14d OR critical blocker unresolved >7d

Step 5 - Report:
## Epic Health Report
### Red (<n>)
- [EPIC-1](<url>) - Progress X%, stalled 21 days, 2 blockers (KEY-A, KEY-B)

### Yellow (<n>)
- [EPIC-2](<url>) - Progress X%, one blocker, scope +15% this week

### Green (<n>)
- [EPIC-3](<url>) - Progress X% on track

### Recommended actions
- Red: convene leads; resolve top blocker
- Yellow: monitor; ensure blocker has owner
- Green: continue`,
  },
  'jira-worklog-summary': {
    description: 'Summarize logged time for a user or team over a period.',
    text: `Summarize time tracking data.

Step 1 - Scope:
- User: user-specified, or jira_get_myself for current
- Team: list of accountIds or via jira_search_users for a group
- Period: default last 7 days, or user-specified

Step 2 - Gather issues the user touched:
- jira_get_user_issues for the target accountId, filter by updated within period
- Alternative broader: jira_search_issues with JQL:
  worklogAuthor = <accountId> AND worklogDate >= -7d

Step 3 - Pull worklogs per issue:
- jira_get_worklogs for each candidate issue
- Filter entries by author = target and started within period

Step 4 - Aggregate:
- Total time logged
- By issue (descending)
- By issuetype (Bug/Story/Task/etc.)
- By epic (group issues under their parent epic)
- Day-by-day breakdown (for detecting under/over-logging days)

Step 5 - Detect anomalies:
- Days with 0 logged time (forgotten worklog?)
- Single-issue bursts (>8h on one issue in a day - scope too big or logging retroactively)
- Time on Done issues (post-completion cleanup or incorrect logging?)

Step 6 - Report:
## Time log summary
Period: <from> - <to>
Person: <displayName>
Total: <Xh Ym> across <N> issues

### By issue
- [KEY](<url>) - summary - <time>
...

### By issuetype
- Bug: <time> (<%>)
- Story: <time> (<%>)
...

### By day
- Mon: <time>
- Tue: <time> (none logged - check)
...

### Signals
- <anomaly>

Useful for: timesheet export, invoice prep, capacity planning, personal retrospective.`,
  },
  'jira-attachment-review': {
    description: 'Review, download, or add attachments on an issue.',
    text: `Work with issue attachments.

Step 1 - List:
- jira_get_attachments for the issueKey
- Each entry has: id, filename, mimeType, size, url

Step 2 - Decide intent:
- Review only: skim filenames + sizes, pick which to download
- Download for analysis: pick specific attachment
- Add new: user supplies local path

Step 3 - Download:
- jira_download_attachment with attachmentId and savePath
  savePath must be inside cwd or user home (sandbox rule)
- After download, any downstream tool (e.g. image-read, text-read) can open the file locally

Step 4 - Add:
- Confirm local filePath exists (absolute path)
- jira_add_attachment with issueKey + filePath
- Mime-type and size inferred automatically

Step 5 - Report:
## Attachments on [KEY](<url>)
- <filename> (<mimeType>, <size>) - <id>
  <downloaded to: path | new upload: filename>

Never guess attachment id - always fetch list first. Never upload files from outside cwd/home.`,
  },
  'jira-watcher-management': {
    description: 'Manage issue watchers (subscribe team, audit who is watching, unsubscribe stale).',
    text: `Manage watchers on an issue.

Step 1 - Audit current state:
- jira_get_watchers for the issueKey
- Returns isWatching (for current auth user), watchCount, and list of watchers

Step 2 - Decide action:
- Subscribe someone: jira_add_watcher (accountId optional - omit to add self)
- Unsubscribe someone: jira_remove_watcher (accountId required)
- Bulk subscribe team: loop jira_add_watcher per accountId (resolve via jira-user-lookup)
- Bulk unsubscribe inactive: check active=false watchers, confirm with user, jira_remove_watcher each

Step 3 - Validate:
- Never pass displayName or email to watcher tools - resolve to accountId first (jira-user-lookup)
- Confirm with user before bulk operations >5 watchers

Step 4 - Report:
## Watchers on [KEY](<url>)
Total: <N>
- <displayName> (<accountId>) <active>
  ACTION: added | removed | unchanged
...`,
  },
  'jira-saved-views': {
    description: 'Discover and execute a saved Jira filter for recurring queries.',
    text: `Use saved Jira filters for recurring analyses.

Step 1 - Find the right filter:
- If user gave a filter name, search: jira_list_filters with filterName substring
- If user gave an owner, filter by accountId
- If nothing, list current user's own filters: jira_get_myself first, then jira_list_filters with that accountId

Step 2 - Inspect before running:
- jira_get_filter with the numeric filterId
- Review the JQL and description so the AI understands semantic intent
- Warn user if JQL is very broad or has no project clause (expensive query)

Step 3 - Run:
- jira_search_by_filter with filterId
- Optional maxResults and nextPageToken for pagination

Step 4 - Use results:
- Summarize returned issues by status/assignee/priority
- If user intent was beyond just listing (e.g. triage, status), chain into the relevant workflow prompt (jira-bug-triage, jira-standup-prep, etc.)

Step 5 - Report:
## Filter: <name> (id <filterId>)
Owner: <displayName>
JQL: <jql>
Returned: <count> issues (isLast=<bool>)

### Issues
- [KEY](<url>) - summary, status, assignee
...

Filters are a stable contract between teams - prefer them over hand-crafted JQL for recurring workflows.`,
  },
  'jira-bulk-transition': {
    description: 'Apply one status transition to many issues (with per-issue success report).',
    text: `Mass-move issues to a new status.

Step 1 - Select issues:
- Via JQL: jira_search_issues (e.g., all "Code Review" tickets for a sprint)
- Via saved filter: jira_search_by_filter
- Via user list (paste a set of keys)

Confirm the list with user before acting - there is no undo.

Step 2 - Determine the transition:
- jira_list_transitions on ONE sample issue from the set to see available transitions
- Same workflow across issues is ideal - different workflows mean transitionId varies per issue

Step 3 - Choose input mode:
- transitionId (faster, assumes same workflow): pass the id from step 2
- transitionName (slower, robust): pass the transition name; tool resolves per issue

Step 4 - Optional comment:
- Pass comment field (Markdown) to leave a trail: "Bulk-transitioned to Done by release cut on <date>"

Step 5 - Execute:
- jira_bulk_transition_issues with issueKeys + transitionId OR transitionName (+ comment)
- Returns succeeded[] and failed[{issueKey,error}]

Step 6 - Report:
## Bulk transition: <N> issues -> <status>
Succeeded (<n>): KEY-1, KEY-2, ...
Failed (<n>):
- KEY-X - reason
- KEY-Y - reason

Recommend retry for recoverable failures (permission, wrong workflow).`,
  },
  'jira-bulk-create': {
    description: 'Create many issues in one call (scaffolding a project, import from external list).',
    text: `Bulk-create issues from a structured list.

Step 1 - Gather input:
- User provides list of items (summary + description + optional issueType/priority/labels)
- Or parse from CSV / Markdown table / Google Sheet export

Step 2 - Normalize each entry:
- Default issueType to Task unless user supplied otherwise
- Default priority to Medium
- Validate labels array (no spaces)
- Convert description Markdown if provided

Step 3 - Validate vs instance:
- Call jira_get_issue_types once to confirm the issueTypes exist for the project
- Call jira_get_priorities once to confirm priorities exist
- Flag any entry with unknown issueType/priority BEFORE calling bulk create

Step 4 - Confirm with user:
Print a summary: "Creating <N> issues in project <KEY>. First 3: <preview>. Continue?"
Wait for explicit go-ahead.

Step 5 - Execute:
- jira_bulk_create_issues with the array
- Max 50 per call; split larger inputs across multiple calls

Step 6 - Report:
## Bulk create: <N> issues
Created:
- [KEY-1](<url>) - summary
- [KEY-2](<url>) - summary
...
Failed entries (if any) with reason.

Useful for: scaffolding a project backlog from a spec, importing Trello/Linear boards, seeding a template project.`,
  },
  'jira-project-overview': {
    description: 'Snapshot a project for onboarding (metadata, components, versions, epics, activity).',
    text: `Produce a project onboarding snapshot.

Step 1 - Identify the project:
- Default from JIRA_PROJECT_KEY or ask user
- If unsure, list all: jira_list_projects and ask user to pick

Step 2 - Core metadata:
- jira_get_project_info - name, key, lead, projectCategory, projectTypeKey (company vs team managed)

Step 3 - Structural data:
- Components: jira_get_project_components - each with name and optional componentLead (tells you who owns what subsystem)
- Versions: jira_get_project_versions - released and unreleased (release cadence indicator)
- Active epics: jira_list_epics with status != Done (strategic work in flight)

Step 4 - Activity:
- Active sprint: jira_list_boards -> jira_list_sprints state=active -> jira_get_sprint
- Recent issues: jira_search_issues with updated >= -14d ORDER BY updated DESC, limit 20
- Most active contributors: derive from changelog on those issues

Step 5 - Format:
## <Project name> (<KEY>)
Type: <company/team-managed> - Lead: <name>
Categories: <list>

### Components (<n>)
- <name> - lead <name or unassigned>
- ...

### Versions
Released: <list with dates>
Upcoming: <list with dates>

### Active epics (<n>)
- [EPIC-1](<url>) - summary
- ...

### Right now
- Active sprint: <name>, <N> issues, <points>
- Most active in last 14d: <top 3 contributors>

### Suggested first reads for a new team member
- [EPIC-X](<url>) - main current initiative
- Last 3 release notes: [V1](<url>), [V2](<url>), [V3](<url>)

Great first prompt to run when joining a new Jira project.`,
  },
  'jira-field-discovery': {
    description: 'Discover custom fields and enum values for the Jira instance (configuration lookup).',
    text: `Discover schema details of this Jira instance.

Step 1 - List all fields:
- jira_get_fields returns ~100+ fields per instance
- Each entry: id, name, custom (bool), schema.type

Step 2 - Filter by intent:
- "Find Story Points field id" -> search fields for name = "Story Points" (usually customfield_10016, varies per instance)
- "Find Epic Link field id" -> search for name = "Epic Link" (customfield_10014 in many instances)
- "Find Sprint field id" -> search for name = "Sprint"
- User-defined custom fields -> filter custom=true

Step 3 - List enum values where the field is not free-text:
- Issue types: jira_get_issue_types (what types can be created)
- Priorities: jira_get_priorities (what priority names are valid)
- Link types: jira_get_link_types (what link names work for jira_link_issues)
- Project-specific options for select fields: no dedicated tool; may require jira_get_issue on an existing issue that uses the field to infer values

Step 4 - Output as reference card:
## <Instance name> field map
### Well-known custom fields
- Story Points: customfield_<id>
- Epic Link: customfield_<id>
- Sprint: customfield_<id>

### Issue types for project <KEY>
- Task, Story, Bug, Sub-task, Epic, ...

### Priorities
- Highest, High, Medium, Low, Lowest, ...

### Link types
- Relates (inward "relates to", outward "relates to")
- Blocks (inward "is blocked by", outward "blocks")
- Duplicate (...), ...

Cache this snapshot locally - it rarely changes. Use it before calling jira_create_issue or jira_update_issue to avoid invalid enum values.`,
  },
  'jira-comment-maintenance': {
    description: 'Edit or remove existing comments (typo fix, redact sensitive info, delete accidental comment).',
    text: `Maintain the comment thread on an issue.

Step 1 - Load comments:
- jira_get_comments for the issueKey
- Each has: id, author, created/updated timestamps, body (ADF -> Markdown)
- Prints optionally ordered by created DESC

Step 2 - Identify target:
- Match by author + timestamp + substring of body
- If ambiguous, show user a numbered list and ask which comment id

Step 3 - Edit:
- jira_update_comment with issueKey + commentId + new Markdown body
- Use this for: typo fixes, adding links to referenced docs, redacting sensitive text, inline corrections

Step 4 - Delete:
- jira_delete_comment with issueKey + commentId
- Use sparingly: deleting is permanent; prefer edit with a strikethrough note when possible
- Always confirm deletion with user before calling

Step 5 - Leave a trail (good practice):
- When redacting, rewrite body as: "~~original sensitive text~~ (redacted <date> by <user>)"
- When fixing a typo, just edit silently
- When deleting intentionally, add a new comment explaining why (if the original had shared context)

Step 6 - Report:
## Comment edits on [KEY](<url>)
- <commentId> - edited (<reason>)
- <commentId> - deleted (<reason>)

NEVER delete someone else's comment without explicit user approval. Prefer edit over delete.`,
  },
  'jira-epic-reorg': {
    description: 'Move issues between epics (consolidation, splitting, reassignment during reorg).',
    text: `Reorganize which epic owns which issues.

Step 1 - Understand the move:
- Source epic (may be empty if pulling from no epic)
- Target epic (can be empty if removing from all epics)
- Issues to move

Step 2 - Audit the source:
- If source given: jira_get_epic_issues on source epic to see current children
- Confirm with user which specific issues to move (do not move everything by default)

Step 3 - Move to target:
- If target given: jira_add_issues_to_epic with targetKey + list of issueKeys
- If target is none (remove from epic): jira_remove_issue_from_epic with issueKeys

Step 4 - Post-move check:
- Re-fetch both epics' children: jira_get_epic_issues
- Ensure moved issues are in the new epic and not in the old

Step 5 - Leave a trail:
- jira_add_comment on each moved issue: "Moved from [EPIC-OLD](<url>) to [EPIC-NEW](<url>) on <date>: <reason>"
- This preserves history without needing to dig through the changelog

Step 6 - Report:
## Epic reorg
- Source: [EPIC-A](<url>) (was <N>, now <M>)
- Target: [EPIC-B](<url>) (was <N>, now <M>)
Moved (<count>):
- [KEY-1](<url>) - summary
- [KEY-2](<url>) - summary

Common scenarios:
- Splitting a large epic: move a coherent subset to a new epic
- Consolidating related epics: merge children of several into one
- Fixing mis-linked work: move stories linked to wrong epic after triage`,
  },
  'jira-worklog-maintenance': {
    description: 'Edit or delete an existing worklog entry (correct wrong time, fix typo in comment, remove duplicate).',
    text: `Maintain existing worklog entries on an issue.

Step 1 - Locate the worklog:
- jira_get_worklogs for the issueKey
- Each entry has: id, author, timeSpent, started, comment
- Filter by self (jira_get_myself for accountId) if user said "my entry"
- If multiple match, show numbered list and ask user which worklogId

Step 2 - Decide intent:
- Wrong duration: jira_update_worklog with new timeSpent only
- Wrong start time: jira_update_worklog with new started (ISO 8601 with millis + offset)
- Typo or missing context in comment: jira_update_worklog with new comment (Markdown)
- Accidental duplicate or wrong issue: jira_delete_worklog (permanent, confirm with user)

Step 3 - Update:
- jira_update_worklog with issueKey + worklogId + ONLY the fields that change
- Pass at least one of timeSpent / comment / started; tool errors otherwise
- timeSpent uses Jira format ("2h 30m", "1d", "45m"); started must be ISO 8601 with offset, not Z

Step 4 - Delete (last resort):
- Confirm with user: "This will permanently remove <timeSpent> logged on <started>. Proceed?"
- jira_delete_worklog with issueKey + worklogId
- After delete, recommend jira_add_worklog if the time was real but on the wrong issue

Step 5 - Verify:
- jira_get_worklogs again, confirm change applied (timeSpent / started / comment)

Step 6 - Report:
## Worklog maintenance on [KEY](<url>)
- <worklogId>: <action> (<before> -> <after> | deleted)

Common scenarios:
- Logged 2h but actually 1h45m -> update timeSpent to "1h 45m"
- Logged today but it was yesterday -> update started with absolute ISO timestamp
- Comment had a wrong issue link -> update comment
- Logged on PROJ-12 by mistake, belonged to PROJ-13 -> delete on PROJ-12, add on PROJ-13

NEVER delete someone else's worklog without explicit user approval. Prefer update over delete.`,
  },
  'jira-worklog-entry': {
    description: 'Log time spent on an issue at end of day (single entry).',
    text: `Log a worklog entry for the current user.

Step 1 - Gather input:
- issueKey (required)
- timeSpent: Jira duration format ("2h 30m", "1d", "45m", "3w 2d")
- comment: optional Markdown description of what was done
- started: optional ISO 8601 with millis and offset ("2024-01-15T09:00:00.000+0000")
  - If omitted, server uses now
  - For "yesterday morning", compute the absolute timestamp and format correctly

Step 2 - Validate inputs:
- timeSpent must match Jira pattern (w/d/h/m units, numeric values)
- started must be ISO 8601 with timezone offset (not Z)
- If user says relative times ("yesterday afternoon"), convert to absolute in their locale

Step 3 - Add the entry:
- jira_add_worklog with issueKey + timeSpent (+ optional comment, started)

Step 4 - Verify:
- jira_get_worklogs for the issue, filter by self (jira_get_myself for accountId)
- Confirm the new entry appears with correct time

Step 5 - Report:
## Worklog added
- Issue: [KEY](<url>)
- Time: <timeSpent>
- Started: <started or "now">
- Comment: <first line>

Optionally: total time logged by you this week (jira-worklog-summary).

For multiple entries in a row (end-of-day batch log), confirm each with user before posting.`,
  },
  'jira-issue-cleanup': {
    description: 'Safely delete an issue (verify no incoming links, confirm intent).',
    text: `Safely delete a Jira issue.

Step 1 - Understand why:
- User must justify: "test issue", "accidental duplicate", "withdrew feature"
- Deletion is permanent and irreversible in Jira

Step 2 - Pre-flight checks:
- jira_get_issue - does the issue exist and what is its state?
- Incoming links: from jira_get_issue response, examine issuelinks (any issue that blocks/relates to/clones this one)
- Worklogs present: jira_get_worklogs - deleting loses logged time
- Comments count: jira_get_comments - losing discussion history
- Attachments: jira_get_attachments - files are deleted too
- Sub-tasks: if parent, list them

Step 3 - Surface impact to user:
## Pre-deletion audit: [KEY](<url>)
- Type: <issuetype>, Status: <status>
- Incoming links from: [K1](<url>), [K2](<url>) (<n>)
- Worklogs: <n> entries totaling <time>
- Comments: <n>
- Attachments: <n>
- Subtasks: <n>

If ANY of the above is non-zero, REQUIRE explicit user confirmation: "This will permanently lose <data>. Proceed?"

Step 4 - Safer alternatives to offer first:
- Close with resolution "Won't Do" instead (keeps history)
- Move to an Archive project (transfer) if your workflow supports it
- Mark with label "archived" and exclude from future searches

Step 5 - If user still wants delete:
- jira_delete_issue with issueKey
- Returns success

Step 6 - Report:
Deleted <KEY> (<summary>).
Lost: <n> comments, <n> attachments, <n> worklogs totaling <time>.
Orphaned incoming links now dangle on: [K1](<url>), [K2](<url>).

NEVER delete without user confirmation. Recommend "Won't Do" resolution first.`,
  },
  'jira-weekly-report': {
    description: 'Cross-project weekly status for management (delivered / planned / risks).',
    text: `Produce a weekly status report suitable for management.

Step 1 - Scope:
- Project(s): user-specified or all via jira_list_projects
- Timeframe: default last 7 days (created/updated/resolved in that window)

Step 2 - Gather data per project:

2a. Delivered this week (resolved issues):
- jira_search_issues with JQL:
  project = "<KEY>" AND resolved >= -7d
- Group by issuetype: Story/Feature count and points, Bug count

2b. Work in progress:
- jira_search_issues with JQL:
  project = "<KEY>" AND statusCategory = "In Progress"
- Count and aggregate assignees

2c. New incoming work:
- jira_search_issues with JQL:
  project = "<KEY>" AND created >= -7d AND issuetype = Bug
- Raw bug inflow rate

2d. Risks:
- High/Highest priority issues unresolved > 14 days (aging)
- Any issue with label "blocked" or "at-risk"
- jira_get_user_issues overload signals (see jira-workload-balance)

Step 3 - Summarize executive-level:
## Week of <Mon> - <Sun>

### Delivered
- <Project>: <N> stories (<P> points), <B> bugs fixed. Highlights: [top 2-3 items with links]

### In flight
- <Project>: <N> issues in progress, <estimated completion>

### Risks
- <concise bullet per risk, linked>

### Needs decision
- [if any] items blocked by external dependency, product call, etc.

Keep each bullet outcome-focused. Avoid Jira jargon when possible. Use clickable links everywhere.`,
  },
};
