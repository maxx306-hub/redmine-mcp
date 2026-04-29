import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const REDMINE_URL = (process.env.REDMINE_URL || "").replace(/\/$/, "");
const REDMINE_API_KEY = process.env.REDMINE_API_KEY || "";
const REDMINE_USER_ID = parseInt(process.env.REDMINE_USER_ID || "0");
const DEFAULT_PROJECT = process.env.REDMINE_DEFAULT_PROJECT || "";

// ── Runtime caches (populated at startup) ────────────────────────────────────

const statusByName  = new Map<string, number>(); // "In Progress" → 2
const activityByName = new Map<string, number>(); // "Development" → 9
let statusNames: string[]   = [];
let activityNames: string[] = [];

async function redmineRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${REDMINE_URL}${path}`, {
    method,
    headers: {
      "X-Redmine-API-Key": REDMINE_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redmine ${res.status}: ${text}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

async function loadMetadata() {
  const [statusRes, activityRes] = await Promise.all([
    redmineRequest<{ issue_statuses: Array<{ id: number; name: string }> }>("GET", "/issue_statuses.json"),
    redmineRequest<{ time_entry_activities: Array<{ id: number; name: string; active: boolean }> }>("GET", "/enumerations/time_entry_activities.json"),
  ]);

  for (const s of statusRes.issue_statuses) {
    statusByName.set(s.name, s.id);
  }
  statusNames = statusRes.issue_statuses.map((s) => s.name);

  for (const a of activityRes.time_entry_activities.filter((a) => a.active)) {
    activityByName.set(a.name, a.id);
  }
  activityNames = activityRes.time_entry_activities.filter((a) => a.active).map((a) => a.name);
}

function resolveStatus(name: string): number {
  const id = statusByName.get(name);
  if (!id) throw new Error(`Unknown status "${name}". Available: ${statusNames.join(", ")}`);
  return id;
}

function resolveActivity(name: string): number {
  const id = activityByName.get(name);
  if (!id) throw new Error(`Unknown activity "${name}". Available: ${activityNames.join(", ")}`);
  return id;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TRACKER_IDS: Record<string, number> = { Feature: 2, Bug: 1, Support: 3, Request: 4 };

const tools: Tool[] = [
  {
    name: "create_issue",
    description: "Create a Redmine issue. Auto-assigns to you.",
    inputSchema: {
      type: "object",
      properties: {
        subject:            { type: "string", description: "Issue title" },
        description:        { type: "string", description: "Issue description (free text)" },
        status:             { type: "string", description: "Redmine status name, e.g. 'In Progress'. Defaults to 'New'" },
        tracker:            { type: "string", enum: ["Feature", "Bug", "Support", "Request"], description: "Tracker type (default: Feature)" },
        estimated_hours:    { type: "number", description: "Estimated time in hours" },
        done_ratio:         { type: "number", description: "Completion percentage 0–100" },
        project_identifier: { type: "string", description: `Project slug (default: ${DEFAULT_PROJECT || "set via REDMINE_DEFAULT_PROJECT"})` },
      },
      required: ["subject"],
    },
  },
  {
    name: "update_issue",
    description: "Update fields on an existing Redmine issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id:        { type: "number", description: "Redmine issue ID" },
        subject:         { type: "string", description: "New title" },
        description:     { type: "string", description: "New description (replaces existing)" },
        status:          { type: "string", description: "New status name, e.g. 'Code Review'" },
        done_ratio:      { type: "number", description: "Completion percentage 0–100" },
        estimated_hours: { type: "number", description: "Estimated time in hours" },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "log_time",
    description: "Log hours on a Redmine issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "number",  description: "Redmine issue ID" },
        hours:    { type: "number",  description: "Hours to log, e.g. 1.5" },
        activity: { type: "string",  description: "Activity name (e.g. 'Development'). Uses first active activity if omitted." },
        comment:  { type: "string",  description: "Optional comment" },
        spent_on: { type: "string",  description: "Date YYYY-MM-DD (default: today)" },
      },
      required: ["issue_id", "hours"],
    },
  },
  {
    name: "get_issue",
    description: "Fetch details of a Redmine issue including logged hours.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "number", description: "Redmine issue ID" },
      },
      required: ["issue_id"],
    },
  },
  {
    name: "list_my_issues",
    description: "List Redmine issues assigned to you.",
    inputSchema: {
      type: "object",
      properties: {
        project_identifier: { type: "string", description: "Filter by project slug (optional)" },
        status: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Status group filter (default: open)",
        },
      },
    },
  },
  {
    name: "list_time_entries",
    description: "List your recent time log entries with issue names.",
    inputSchema: {
      type: "object",
      properties: {
        limit:              { type: "number", description: "Number of entries (default: 10, max: 100)" },
        issue_id:           { type: "number", description: "Filter by issue ID (optional)" },
        project_identifier: { type: "string", description: "Filter by project slug (optional)" },
      },
    },
  },
  {
    name: "list_statuses",
    description: "List all available Redmine issue statuses.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ── Interfaces ────────────────────────────────────────────────────────────────

interface RedmineIssueResponse {
  issue: {
    id: number;
    subject: string;
    status: { name: string };
    assigned_to?: { name: string };
    description: string;
    spent_hours: number;
    estimated_hours?: number;
    done_ratio: number;
    created_on: string;
    updated_on: string;
    project: { name: string };
  };
}

interface RedmineIssueListResponse {
  issues: Array<{
    id: number;
    subject: string;
    status: { name: string };
    project: { name: string };
    spent_hours: number;
  }>;
  total_count: number;
}

interface RedmineTimeEntriesResponse {
  time_entries: Array<{
    id: number;
    spent_on: string;
    hours: number;
    activity: { name: string };
    comments: string;
    project: { name: string };
    issue?: { id: number };
  }>;
  total_count: number;
}

interface RedmineTimeEntryResponse {
  time_entry: { id: number; hours: number };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleCreateIssue(args: {
  subject: string;
  description?: string;
  status?: string;
  tracker?: string;
  estimated_hours?: number;
  done_ratio?: number;
  project_identifier?: string;
}): Promise<string> {
  const project   = args.project_identifier || DEFAULT_PROJECT;
  const trackerId = TRACKER_IDS[args.tracker ?? "Feature"];
  const statusId  = args.status ? resolveStatus(args.status) : resolveStatus("New");

  const issueBody: Record<string, unknown> = {
    project_id:     project,
    subject:        args.subject,
    description:    args.description ?? "",
    assigned_to_id: REDMINE_USER_ID,
    status_id:      statusId,
    tracker_id:     trackerId,
  };
  if (args.estimated_hours !== undefined) issueBody.estimated_hours = args.estimated_hours;
  if (args.done_ratio      !== undefined) issueBody.done_ratio      = args.done_ratio;

  const result = await redmineRequest<RedmineIssueResponse>("POST", "/issues.json", { issue: issueBody });
  const i = result.issue;

  return [
    `Created #${i.id}: "${i.subject}"`,
    `Status: ${i.status.name}`,
    `URL: ${REDMINE_URL}/issues/${i.id}`,
  ].join("\n");
}

async function handleUpdateIssue(args: {
  issue_id: number;
  subject?: string;
  description?: string;
  status?: string;
  done_ratio?: number;
  estimated_hours?: number;
}): Promise<string> {
  const update: Record<string, unknown> = {};
  if (args.subject         !== undefined) update.subject         = args.subject;
  if (args.description     !== undefined) update.description     = args.description;
  if (args.done_ratio      !== undefined) update.done_ratio      = args.done_ratio;
  if (args.estimated_hours !== undefined) update.estimated_hours = args.estimated_hours;
  if (args.status)                        update.status_id       = resolveStatus(args.status);

  await redmineRequest("PUT", `/issues/${args.issue_id}.json`, { issue: update });

  const parts: string[] = [];
  if (args.status          !== undefined) parts.push(`status: ${args.status}`);
  if (args.done_ratio      !== undefined) parts.push(`done: ${args.done_ratio}%`);
  if (args.estimated_hours !== undefined) parts.push(`estimate: ${args.estimated_hours}h`);
  if (args.subject         !== undefined) parts.push(`subject updated`);
  if (args.description     !== undefined) parts.push(`description updated`);

  return `Updated #${args.issue_id} — ${parts.join(", ")}`;
}

async function handleLogTime(args: {
  issue_id: number;
  hours: number;
  activity?: string;
  comment?: string;
  spent_on?: string;
}): Promise<string> {
  const activityId = args.activity
    ? resolveActivity(args.activity)
    : activityByName.values().next().value;
  const spentOn = args.spent_on || new Date().toISOString().split("T")[0];

  const result = await redmineRequest<RedmineTimeEntryResponse>("POST", "/time_entries.json", {
    time_entry: {
      issue_id:    args.issue_id,
      hours:       args.hours,
      activity_id: activityId,
      comments:    args.comment || "",
      spent_on:    spentOn,
    },
  });

  return `Logged ${result.time_entry.hours}h on #${args.issue_id} (entry ID: ${result.time_entry.id}, date: ${spentOn})`;
}

async function handleGetIssue(args: { issue_id: number }): Promise<string> {
  const result = await redmineRequest<RedmineIssueResponse>("GET", `/issues/${args.issue_id}.json`);
  const i = result.issue;
  return [
    `#${i.id}: ${i.subject}`,
    `Project:     ${i.project.name}`,
    `Status:      ${i.status.name}`,
    `Done:        ${i.done_ratio}%`,
    `Assigned to: ${i.assigned_to?.name ?? "Unassigned"}`,
    `Estimated:   ${i.estimated_hours ?? "—"}h`,
    `Spent:       ${i.spent_hours}h`,
    `URL:         ${REDMINE_URL}/issues/${i.id}`,
    ``,
    `Description:\n${i.description}`,
  ].join("\n");
}

async function handleListMyIssues(args: {
  project_identifier?: string;
  status?: string;
}): Promise<string> {
  const statusParam =
    args.status === "closed" ? "closed" :
    args.status === "all"    ? "*"      : "open";

  const params = new URLSearchParams({
    assigned_to_id: String(REDMINE_USER_ID),
    status_id:      statusParam,
    limit:          "50",
  });
  if (args.project_identifier) params.set("project_id", args.project_identifier);

  const result = await redmineRequest<RedmineIssueListResponse>("GET", `/issues.json?${params}`);
  if (!result.issues.length) return "No issues found.";

  const lines = result.issues.map(
    (i) => `#${i.id} [${i.status.name}] ${i.subject} — ${i.project.name} (${i.spent_hours}h logged)`
  );
  return `${result.total_count} issue(s) assigned to you:\n\n${lines.join("\n")}`;
}

async function handleListTimeEntries(args: {
  limit?: number;
  issue_id?: number;
  project_identifier?: string;
}): Promise<string> {
  const params = new URLSearchParams({
    user_id: String(REDMINE_USER_ID),
    limit:   String(Math.min(args.limit ?? 10, 100)),
    sort:    "spent_on:desc",
  });
  if (args.issue_id)           params.set("issue_id",   String(args.issue_id));
  if (args.project_identifier) params.set("project_id", args.project_identifier);

  const result = await redmineRequest<RedmineTimeEntriesResponse>("GET", `/time_entries.json?${params}`);
  if (!result.time_entries.length) return "No time entries found.";

  const issueIds = [...new Set(result.time_entries.flatMap((e) => e.issue ? [e.issue.id] : []))];
  const issueMap = new Map<number, string>();
  await Promise.all(
    issueIds.map(async (id) => {
      try {
        const r = await redmineRequest<RedmineIssueResponse>("GET", `/issues/${id}.json`);
        issueMap.set(id, r.issue.subject);
      } catch {
        issueMap.set(id, "?");
      }
    })
  );

  const lines = result.time_entries.map((e) => {
    const issueRef = e.issue ? ` #${e.issue.id} "${issueMap.get(e.issue.id) ?? "?"}"` : "";
    const comment  = e.comments ? `  — "${e.comments}"` : "";
    return `${e.spent_on}  ${e.hours}h${issueRef}  [${e.activity.name}]${comment}`;
  });

  return `${result.total_count} total entries (showing ${result.time_entries.length}):\n\n${lines.join("\n")}`;
}

function handleListStatuses(): string {
  if (!statusNames.length) return "No statuses loaded yet.";
  return `Available statuses:\n${statusNames.map((s) => `  • ${s}`).join("\n")}`;
}

// ── Server wiring ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "redmine-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let text: string;
    switch (name) {
      case "create_issue":     text = await handleCreateIssue(args as Parameters<typeof handleCreateIssue>[0]);       break;
      case "update_issue":     text = await handleUpdateIssue(args as Parameters<typeof handleUpdateIssue>[0]);       break;
      case "log_time":         text = await handleLogTime(args as Parameters<typeof handleLogTime>[0]);               break;
      case "get_issue":        text = await handleGetIssue(args as Parameters<typeof handleGetIssue>[0]);             break;
      case "list_my_issues":   text = await handleListMyIssues(args as Parameters<typeof handleListMyIssues>[0]);     break;
      case "list_time_entries":text = await handleListTimeEntries(args as Parameters<typeof handleListTimeEntries>[0]);break;
      case "list_statuses":    text = handleListStatuses();                                                           break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

async function main() {
  await loadMetadata();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
