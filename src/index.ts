import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

const REDMINE_URL = (process.env.REDMINE_URL || "https://project.mirko.in.ua").replace(/\/$/, "");
const REDMINE_API_KEY = process.env.REDMINE_API_KEY || "";
const REDMINE_USER_ID = parseInt(process.env.REDMINE_USER_ID || "33");
const DEFAULT_PROJECT = process.env.REDMINE_DEFAULT_PROJECT || "jdm-360";

// Jira status → Redmine status ID
// Redmine statuses: New(1), In Progress(2), Blocked(12), Code Review(7),
// Test DEV(8), Prepare to deploy PROD(10), Test PROD(9),
// Resolved(3), Feedback(4), For Payment(11), Closed(5), Rejected(6)
const JIRA_TO_REDMINE_STATUS: Record<string, { id: number; label: string }> = {
  "In Progress": { id: 2,  label: "In Progress"            },
  "QAT":         { id: 7,  label: "Code Review"             },
  "UAT":         { id: 8,  label: "Test DEV"               },
  "Done":        { id: 3,  label: "Resolved"               },
  "Deployed":    { id: 5,  label: "Closed"                 },
};

const ACTIVITY_IDS: Record<string, number> = {
  Development: 9,
  Over:        10,
  Estimate:    11,
};

async function redmineRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${REDMINE_URL}${path}`;
  const res = await fetch(url, {
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

// ── Tool definitions ──────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "create_issue",
    description:
      "Create a Redmine issue mirroring a Jira ticket. Auto-assigns to you, " +
      "adds the Jira link to the description, and maps the Jira status to the " +
      "closest Redmine status.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Issue title — copy from Jira summary",
        },
        jira_key: {
          type: "string",
          description: "Jira issue key, e.g. SCRUM-759",
        },
        jira_url: {
          type: "string",
          description: "Full URL to the Jira issue",
        },
        jira_status: {
          type: "string",
          enum: ["In Progress", "QAT", "UAT", "Done", "Deployed"],
          description: "Current Jira status to mirror in Redmine",
        },
        project_identifier: {
          type: "string",
          description: `Redmine project slug (default: ${DEFAULT_PROJECT})`,
        },
        tracker: {
          type: "string",
          enum: ["Feature", "Bug", "Support", "Request"],
          description: "Issue tracker type (default: Feature)",
        },
        estimated_hours: {
          type: "number",
          description: "Estimated time in hours",
        },
        done_ratio: {
          type: "number",
          description: "Completion percentage 0–100",
        },
        description: {
          type: "string",
          description: "Extra details to append below the Jira back-link",
        },
      },
      required: ["subject", "jira_key", "jira_url", "jira_status"],
    },
  },
  {
    name: "log_time",
    description: "Log hours on a Redmine issue.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "number", description: "Redmine issue ID" },
        hours:    { type: "number", description: "Hours to log, e.g. 1.5" },
        activity: {
          type: "string",
          enum: ["Development", "Over", "Estimate"],
          description: "Activity type (default: Development)",
        },
        comment:  { type: "string", description: "Optional comment" },
        spent_on: {
          type: "string",
          description: "Date YYYY-MM-DD (default: today)",
        },
      },
      required: ["issue_id", "hours"],
    },
  },
  {
    name: "update_status",
    description: "Update a Redmine issue status to mirror a Jira status change.",
    inputSchema: {
      type: "object",
      properties: {
        issue_id: { type: "number", description: "Redmine issue ID" },
        jira_status: {
          type: "string",
          enum: ["In Progress", "QAT", "UAT", "Done", "Deployed"],
          description: "New Jira status to reflect in Redmine",
        },
      },
      required: ["issue_id", "jira_status"],
    },
  },
  {
    name: "update_issue",
    description: "Update fields on an existing Redmine issue (done %, estimated hours, status, subject).",
    inputSchema: {
      type: "object",
      properties: {
        issue_id:        { type: "number", description: "Redmine issue ID" },
        done_ratio:      { type: "number", description: "Completion percentage 0–100" },
        estimated_hours: { type: "number", description: "Estimated time in hours" },
        jira_status: {
          type: "string",
          enum: ["In Progress", "QAT", "UAT", "Done", "Deployed"],
          description: "New Jira status to mirror in Redmine (optional)",
        },
        subject: { type: "string", description: "New subject/title (optional)" },
      },
      required: ["issue_id"],
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
    name: "list_time_entries",
    description: "List your recent time log entries, optionally filtered by issue or project.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Number of entries to return (default: 10, max: 100)",
        },
        issue_id: {
          type: "number",
          description: "Filter by a specific Redmine issue ID (optional)",
        },
        project_identifier: {
          type: "string",
          description: "Filter by project slug (optional)",
        },
      },
    },
  },
  {
    name: "list_my_issues",
    description: "List Redmine issues assigned to you, optionally filtered by project or status.",
    inputSchema: {
      type: "object",
      properties: {
        project_identifier: {
          type: "string",
          description: "Filter by project slug (optional)",
        },
        status: {
          type: "string",
          enum: ["open", "closed", "all"],
          description: "Filter by status group (default: open)",
        },
      },
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

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

interface RedmineIssueResponse {
  issue: {
    id: number;
    subject: string;
    status: { name: string };
    assigned_to?: { name: string };
    description: string;
    spent_hours: number;
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

interface RedmineTimeEntryResponse {
  time_entry: { id: number; hours: number };
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

  // Fetch subjects for all unique issue IDs in parallel
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
    const comment = e.comments ? `  — "${e.comments}"` : "";
    return `${e.spent_on}  ${e.hours}h${issueRef}  [${e.activity.name}]${comment}`;
  });

  return `${result.total_count} total entries (showing ${result.time_entries.length}):\n\n${lines.join("\n")}`;
}

const TRACKER_IDS: Record<string, number> = { Feature: 2, Bug: 1, Support: 3, Request: 4 };

async function handleUpdateIssue(args: {
  issue_id: number;
  done_ratio?: number;
  estimated_hours?: number;
  jira_status?: string;
  subject?: string;
}): Promise<string> {
  const update: Record<string, unknown> = {};
  if (args.done_ratio      !== undefined) update.done_ratio      = args.done_ratio;
  if (args.estimated_hours !== undefined) update.estimated_hours = args.estimated_hours;
  if (args.subject         !== undefined) update.subject         = args.subject;
  if (args.jira_status) {
    const status = JIRA_TO_REDMINE_STATUS[args.jira_status];
    update.status_id = status.id;
  }

  await redmineRequest("PUT", `/issues/${args.issue_id}.json`, { issue: update });

  const parts: string[] = [];
  if (args.done_ratio      !== undefined) parts.push(`done: ${args.done_ratio}%`);
  if (args.estimated_hours !== undefined) parts.push(`estimate: ${args.estimated_hours}h`);
  if (args.jira_status)                   parts.push(`status: ${JIRA_TO_REDMINE_STATUS[args.jira_status].label}`);
  if (args.subject)                       parts.push(`subject updated`);

  return `Updated #${args.issue_id} — ${parts.join(", ")}`;
}

async function handleCreateIssue(args: {
  subject: string;
  jira_key: string;
  jira_url: string;
  jira_status: string;
  tracker?: string;
  estimated_hours?: number;
  done_ratio?: number;
  project_identifier?: string;
  description?: string;
}): Promise<string> {
  const project = args.project_identifier || DEFAULT_PROJECT;
  const status = JIRA_TO_REDMINE_STATUS[args.jira_status];

  const descParts = [`*Jira:* [${args.jira_key}](${args.jira_url})`];
  if (args.description) descParts.push("", args.description);

  const trackerId = TRACKER_IDS[args.tracker ?? "Feature"];

  const issueBody: Record<string, unknown> = {
    project_id:     project,
    subject:        args.subject,
    description:    descParts.join("\n"),
    assigned_to_id: REDMINE_USER_ID,
    status_id:      status.id,
    tracker_id:     trackerId,
  };
  if (args.estimated_hours !== undefined) issueBody.estimated_hours = args.estimated_hours;
  if (args.done_ratio      !== undefined) issueBody.done_ratio      = args.done_ratio;

  const result = await redmineRequest<RedmineIssueResponse>("POST", "/issues.json", { issue: issueBody });

  return (
    `Created #${result.issue.id}: "${result.issue.subject}"\n` +
    `Status: ${status.label}\n` +
    `URL: ${REDMINE_URL}/issues/${result.issue.id}`
  );
}

async function handleLogTime(args: {
  issue_id: number;
  hours: number;
  activity?: string;
  comment?: string;
  spent_on?: string;
}): Promise<string> {
  const activityId = args.activity ? (ACTIVITY_IDS[args.activity] ?? ACTIVITY_IDS.Development) : ACTIVITY_IDS.Development;
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

async function handleUpdateStatus(args: {
  issue_id: number;
  jira_status: string;
}): Promise<string> {
  const status = JIRA_TO_REDMINE_STATUS[args.jira_status];
  await redmineRequest("PUT", `/issues/${args.issue_id}.json`, {
    issue: { status_id: status.id },
  });
  return `Updated #${args.issue_id} → "${status.label}" (mirrors Jira: ${args.jira_status})`;
}

async function handleGetIssue(args: { issue_id: number }): Promise<string> {
  const result = await redmineRequest<RedmineIssueResponse>(
    "GET",
    `/issues/${args.issue_id}.json`
  );
  const i = result.issue;
  return [
    `#${i.id}: ${i.subject}`,
    `Project:     ${i.project.name}`,
    `Status:      ${i.status.name}`,
    `Assigned to: ${i.assigned_to?.name ?? "Unassigned"}`,
    `Spent hours: ${i.spent_hours}h`,
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

  const result = await redmineRequest<RedmineIssueListResponse>(`GET`, `/issues.json?${params}`);
  if (!result.issues.length) return "No issues found.";

  const lines = result.issues.map(
    (i) => `#${i.id} [${i.status.name}] ${i.subject} — ${i.project.name} (${i.spent_hours}h logged)`
  );
  return `${result.total_count} issue(s) assigned to you:\n\n${lines.join("\n")}`;
}

// ── Server wiring ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "redmine-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let text: string;
    switch (name) {
      case "list_time_entries": text = await handleListTimeEntries(args as Parameters<typeof handleListTimeEntries>[0]); break;
      case "update_issue":      text = await handleUpdateIssue(args as Parameters<typeof handleUpdateIssue>[0]);         break;
      case "create_issue":    text = await handleCreateIssue(args as Parameters<typeof handleCreateIssue>[0]);    break;
      case "log_time":        text = await handleLogTime(args as Parameters<typeof handleLogTime>[0]);             break;
      case "update_status":   text = await handleUpdateStatus(args as Parameters<typeof handleUpdateStatus>[0]);   break;
      case "get_issue":       text = await handleGetIssue(args as Parameters<typeof handleGetIssue>[0]);           break;
      case "list_my_issues":  text = await handleListMyIssues(args as Parameters<typeof handleListMyIssues>[0]);   break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
