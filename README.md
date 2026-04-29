# redmine-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Redmine, built in TypeScript. Designed for workflows where Jira is the source of truth and Redmine is used for internal time tracking and task mirroring.

## Features

- **Mirror Jira tickets** to Redmine with one command — auto-assigns to you, adds Jira back-link, maps status
- **Log time** on any issue with activity type and optional comment
- **List your time entries** with issue names, filterable by project or issue
- **Update issues** — done percentage, estimated hours, status sync
- **List your issues** — filterable by project and status

## Jira → Redmine Status Mapping

| Jira | Redmine |
|------|---------|
| In Progress | In Progress |
| QAT | Code Review |
| UAT | Test DEV |
| Done | Resolved |
| Deployed | Closed |

## Installation

### 1. Clone and build

```bash
git clone https://github.com/YOUR_USERNAME/redmine-mcp.git
cd redmine-mcp
npm install
npm run build
```

### 2. Register with Claude Code

```bash
claude mcp add redmine \
  --scope user \
  -e REDMINE_URL=https://your-redmine.example.com \
  -e REDMINE_API_KEY=your_api_key_here \
  -e REDMINE_USER_ID=your_user_id \
  -e REDMINE_DEFAULT_PROJECT=your-project-slug \
  -- node /absolute/path/to/redmine-mcp/dist/index.js
```

**Where to find your values:**
- `REDMINE_API_KEY` — Redmine → *My Account* → *API access key*
- `REDMINE_USER_ID` — the numeric ID in your Redmine profile URL
- `REDMINE_DEFAULT_PROJECT` — the short slug from the project URL (e.g. `my-project`)

### 3. Reconnect in Claude Code

Run `/mcp` and reconnect the `redmine` server, or restart Claude Code.

## Available Tools

### `create_issue`
Create a Redmine issue mirroring a Jira ticket.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `subject` | ✓ | Issue title |
| `jira_key` | ✓ | e.g. `SCRUM-123` |
| `jira_url` | ✓ | Full Jira issue URL |
| `jira_status` | ✓ | `In Progress` \| `QAT` \| `UAT` \| `Done` \| `Deployed` |
| `tracker` | | `Feature` (default) \| `Bug` \| `Support` \| `Request` |
| `estimated_hours` | | Estimated time in hours |
| `done_ratio` | | Completion percentage 0–100 |
| `project_identifier` | | Overrides default project |
| `description` | | Extra text appended below Jira link |

### `log_time`
Log hours on a Redmine issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issue_id` | ✓ | Redmine issue ID |
| `hours` | ✓ | e.g. `1.5` |
| `activity` | | `Development` (default) \| `Over` \| `Estimate` |
| `comment` | | Optional comment |
| `spent_on` | | Date `YYYY-MM-DD` (default: today) |

### `update_issue`
Update fields on an existing issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issue_id` | ✓ | Redmine issue ID |
| `done_ratio` | | Completion percentage 0–100 |
| `estimated_hours` | | Estimated time in hours |
| `jira_status` | | Mirror a new Jira status |
| `subject` | | New title |

### `update_status`
Shorthand to sync only the status from a Jira transition.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issue_id` | ✓ | Redmine issue ID |
| `jira_status` | ✓ | New Jira status to mirror |

### `get_issue`
Fetch issue details including spent hours.

### `list_my_issues`
List issues assigned to you.

| Parameter | Description |
|-----------|-------------|
| `project_identifier` | Filter by project slug (optional) |
| `status` | `open` (default) \| `closed` \| `all` |

### `list_time_entries`
List your recent time log entries with issue names.

| Parameter | Description |
|-----------|-------------|
| `limit` | Number of entries (default: 10, max: 100) |
| `issue_id` | Filter by issue (optional) |
| `project_identifier` | Filter by project (optional) |

## Development

```bash
npm run dev    # watch mode (recompiles on save)
npm run build  # one-off build
```

After rebuilding, reconnect the server in Claude Code via `/mcp`.

## Time Entry Activities

Configured for the default Redmine activity types:

| Name | ID |
|------|----|
| Development | 9 |
| Over | 10 |
| Estimate | 11 |

These IDs vary per Redmine installation — update `ACTIVITY_IDS` in `src/index.ts` if needed.
