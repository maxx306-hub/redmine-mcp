# redmine-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Redmine, built in TypeScript. Works with any Redmine instance — statuses and activity types are fetched dynamically at startup.

## Features

- **Create issues** — free-form description, any status, any tracker. Optional Jira back-link convenience params.
- **Log time** with any activity type (fetched from your Redmine instance)
- **List your time entries** with issue names, filterable by project or issue
- **Update issues** — done percentage, estimated hours, status, description
- **List your issues** — filterable by project and status group
- **List statuses** — discover all available statuses on your Redmine instance

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
Create a Redmine issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `subject` | ✓ | Issue title |
| `description` | | Free-form description |
| `status` | | Redmine status name (default: `New`) |
| `tracker` | | `Feature` (default) \| `Bug` \| `Support` \| `Request` |
| `estimated_hours` | | Estimated time in hours |
| `done_ratio` | | Completion percentage 0–100 |
| `project_identifier` | | Overrides default project |

### `log_time`
Log hours on a Redmine issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issue_id` | ✓ | Redmine issue ID |
| `hours` | ✓ | e.g. `1.5` |
| `activity` | | Activity name from your Redmine instance (uses first active activity if omitted) |
| `comment` | | Optional comment |
| `spent_on` | | Date `YYYY-MM-DD` (default: today) |

### `update_issue`
Update fields on an existing issue.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issue_id` | ✓ | Redmine issue ID |
| `status` | | New Redmine status name |
| `done_ratio` | | Completion percentage 0–100 |
| `estimated_hours` | | Estimated time in hours |
| `subject` | | New title |
| `description` | | New description (replaces existing) |

### `list_statuses`
List all available status names on your Redmine instance. Useful for discovering valid values for the `status` parameter.

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

## Dynamic Metadata

Statuses and time entry activities are fetched from your Redmine instance at startup — no hardcoded IDs. Use the `list_statuses` tool to see what's available on your instance.
