"use client";

import {
  useMemo,
  useState,
} from "react";

import type {
  ChangeEvent,
  FormEvent,
} from "react";

const SUPERVISOR_API =
  "/api/atlas/engineering/supervisor";

const OWNER_ACTION_HEADER =
  "x-atlas-supervisor-owner-action";

const WORKER_OWNERS = [
  "engineering",
  "frontend",
  "backend",
  "database",
  "qa",
  "infra",
] as const;

type WorkerOwner =
  (typeof WORKER_OWNERS)[number];

const SUPERVISOR_ACTIONS = [
  "read_repo",
  "search_repo",
  "edit_assigned_files",
  "run_tests",
  "run_build",
  "commit_assigned_branch",
  "change_database_schema",
  "run_migration",
  "change_auth_or_identity",
  "change_runtime_config",
  "deploy_non_production",
  "deploy_production",
  "merge",
  "rebase",
  "squash",
  "cherry_pick",
  "auto_merge",
  "force_push",
  "delete_branch_for_integration",
] as const;

type SupervisorAction =
  (typeof SUPERVISOR_ACTIONS)[number];

export type SupervisorTaskInput = {
  objective: string;
  owner: WorkerOwner;
  allowedPaths: string[];
  forbiddenActions: SupervisorAction[];
  dependsOn: string[];
  acceptance: string[];
};

export type SupervisorTaskDraft = {
  objective: string;
  owner: string;
  allowedPathsText: string;
  forbiddenActionsText: string;
  dependsOnText: string;
  acceptanceText: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

type JsonRecord =
  Record<string, unknown>;

export type SupervisorAdmissionResult = {
  taskId: string;
  taskStatus: "WORKING";
  executionId: string;
  executionStatus: "DISPATCHED";
};

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isWorkerOwner(
  value: string,
): value is WorkerOwner {
  return (
    WORKER_OWNERS as readonly string[]
  ).includes(value);
}

function isSupervisorAction(
  value: string,
): value is SupervisorAction {
  return (
    SUPERVISOR_ACTIONS as readonly string[]
  ).includes(value);
}

export function normalizeTaskInput(
  draft: SupervisorTaskDraft,
): SupervisorTaskInput {
  const objective = draft.objective.trim();
  const owner = draft.owner.trim();
  const allowedPaths = unique(
    parseLines(draft.allowedPathsText),
  );
  const forbiddenActionValues = unique(
    parseLines(draft.forbiddenActionsText),
  );
  const dependsOn = unique(
    parseLines(draft.dependsOnText),
  );
  const acceptance = unique(
    parseLines(draft.acceptanceText),
  );

  if (!objective) {
    throw new Error(
      "Objective is required.",
    );
  }

  if (!isWorkerOwner(owner)) {
    throw new Error(
      "Owner must be an allowed worker role.",
    );
  }

  if (!allowedPaths.length) {
    throw new Error(
      "At least one allowed path is required.",
    );
  }

  if (!acceptance.length) {
    throw new Error(
      "At least one acceptance condition is required.",
    );
  }

  const invalidAction =
    forbiddenActionValues.find(
      (value) =>
        !isSupervisorAction(value),
    );

  if (invalidAction) {
    throw new Error(
      `Unknown forbidden action: ${invalidAction}`,
    );
  }

  return {
    objective,
    owner,
    allowedPaths,
    forbiddenActions:
      forbiddenActionValues as SupervisorAction[],
    dependsOn,
    acceptance,
  };
}

function asRecord(
  value: unknown,
): JsonRecord | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as JsonRecord;
}

async function parseResponse(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetail(
  body: unknown,
): string {
  if (typeof body === "string") {
    return body;
  }

  const record = asRecord(body);

  if (!record) {
    return "unknown error";
  }

  const message = record.message;

  if (typeof message === "string") {
    return message;
  }

  try {
    return JSON.stringify(body);
  } catch {
    return "unknown error";
  }
}

async function postSupervisor(
  stage: string,
  path: string,
  body: unknown,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let response:
    Awaited<ReturnType<FetchLike>>;

  try {
    response = await fetchImpl(
      `${SUPERVISOR_API}${path}`,
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          [OWNER_ACTION_HEADER]: "1",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "network failure";

    throw new Error(
      `${stage} request failed before a confirmed response: ${message}. Do not retry blindly; verify actual Supervisor state first.`,
    );
  }

  const parsed = await parseResponse(response);

  if (!response.ok) {
    throw new Error(
      `${stage} failed (HTTP ${response.status}): ${errorDetail(parsed)}`,
    );
  }

  return parsed;
}

function requireStringField(
  value: unknown,
  field: string,
  label: string,
): string {
  const record = asRecord(value);
  const candidate = record?.[field];

  if (
    typeof candidate !== "string" ||
    !candidate.trim()
  ) {
    const fieldLabel =
      field === "id" ? "task id" : field;

    throw new Error(
      `${label} response is missing ${fieldLabel}. Stop and verify Supervisor state.`,
    );
  }

  return candidate;
}

export async function runSupervisorAdmission(
  input: SupervisorTaskInput,
  fetchImpl: FetchLike = fetch,
): Promise<SupervisorAdmissionResult> {
  const created = await postSupervisor(
    "create task",
    "/tasks",
    input,
    fetchImpl,
  );

  const taskId = requireStringField(
    created,
    "id",
    "create task",
  );

  const started = await postSupervisor(
    "start task",
    `/tasks/${encodeURIComponent(taskId)}/start`,
    {},
    fetchImpl,
  );

  const startedRecord = asRecord(started);

  if (
    startedRecord?.id !== taskId ||
    startedRecord?.status !== "WORKING"
  ) {
    throw new Error(
      "start task response did not confirm the same task in WORKING state. Stop before dispatch.",
    );
  }

  const dispatched = await postSupervisor(
    "dispatch execution",
    `/tasks/${encodeURIComponent(taskId)}/dispatch`,
    {},
    fetchImpl,
  );

  const dispatchRecord = asRecord(dispatched);
  const executionRecord = asRecord(
    dispatchRecord?.execution,
  );
  const executionId =
    executionRecord?.id;
  const executionStatus =
    executionRecord?.status;

  if (
    typeof executionId !== "string" ||
    !executionId.trim() ||
    executionStatus !== "DISPATCHED"
  ) {
    throw new Error(
      "dispatch response did not confirm a DISPATCHED execution. Stop and verify Supervisor state.",
    );
  }

  return {
    taskId,
    taskStatus: "WORKING",
    executionId,
    executionStatus: "DISPATCHED",
  };
}

const DEFAULT_FORBIDDEN = [
  "change_database_schema",
  "run_migration",
  "change_auth_or_identity",
  "change_runtime_config",
  "deploy_non_production",
  "deploy_production",
  "merge",
  "rebase",
  "squash",
  "cherry_pick",
  "auto_merge",
  "force_push",
  "delete_branch_for_integration",
].join("\n");

const panelStyle = {
  maxWidth: 920,
  margin: "0 auto",
  padding: "32px 24px 56px",
} as const;

const cardStyle = {
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 18,
  padding: 24,
  background: "rgba(15, 23, 42, 0.55)",
} as const;

const labelStyle = {
  display: "grid",
  gap: 8,
  marginTop: 18,
  fontWeight: 600,
} as const;

const fieldStyle = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.35)",
  borderRadius: 10,
  padding: "10px 12px",
  background: "rgba(2, 6, 23, 0.65)",
  color: "inherit",
  font: "inherit",
} as const;

export function SupervisorOwnerPanel() {
  const [objective, setObjective] =
    useState("");
  const [owner, setOwner] =
    useState<WorkerOwner>("engineering");
  const [allowedPathsText, setAllowedPathsText] =
    useState("");
  const [forbiddenActionsText, setForbiddenActionsText] =
    useState(DEFAULT_FORBIDDEN);
  const [dependsOnText, setDependsOnText] =
    useState("");
  const [acceptanceText, setAcceptanceText] =
    useState("");
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [result, setResult] =
    useState<SupervisorAdmissionResult | null>(null);

  const scopeCount = useMemo(
    () =>
      parseLines(allowedPathsText).length,
    [allowedPathsText],
  );

  async function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const input = normalizeTaskInput({
        objective,
        owner,
        allowedPathsText,
        forbiddenActionsText,
        dependsOnText,
        acceptanceText,
      });

      const admission =
        await runSupervisorAdmission(input);

      setResult(admission);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Supervisor admission failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={panelStyle}>
      <div style={{ marginBottom: 24 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            opacity: 0.7,
          }}
        >
          Human Owner Control Surface
        </p>
        <h1 style={{ margin: "8px 0 10px" }}>
          Supervisor Admission
        </h1>
        <p style={{ margin: 0, opacity: 0.78 }}>
          Creates one task, starts it, then dispatches one execution through the authenticated same-origin Atlas proxy. The API remains the authority for Human Owner identity and scope enforcement.
        </p>
      </div>

      <form onSubmit={submit} style={cardStyle}>
        <label style={labelStyle}>
          Objective
          <textarea
            value={objective}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setObjective(event.target.value)
            }
            rows={4}
            style={fieldStyle}
            placeholder="Exact engineering objective"
            disabled={busy}
          />
        </label>

        <label style={labelStyle}>
          Worker owner
          <select
            value={owner}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setOwner(
                event.target.value as WorkerOwner,
              )
            }
            style={fieldStyle}
            disabled={busy}
          >
            {WORKER_OWNERS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          Allowed paths — one per line ({scopeCount})
          <textarea
            value={allowedPathsText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setAllowedPathsText(
                event.target.value,
              )
            }
            rows={9}
            spellCheck={false}
            style={fieldStyle}
            placeholder="apps/api/src/..."
            disabled={busy}
          />
        </label>

        <label style={labelStyle}>
          Forbidden actions — one per line
          <textarea
            value={forbiddenActionsText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setForbiddenActionsText(
                event.target.value,
              )
            }
            rows={8}
            spellCheck={false}
            style={fieldStyle}
            disabled={busy}
          />
        </label>

        <label style={labelStyle}>
          Dependencies — one task ID per line
          <textarea
            value={dependsOnText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setDependsOnText(
                event.target.value,
              )
            }
            rows={3}
            spellCheck={false}
            style={fieldStyle}
            placeholder="Optional"
            disabled={busy}
          />
        </label>

        <label style={labelStyle}>
          Acceptance — one condition per line
          <textarea
            value={acceptanceText}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setAcceptanceText(
                event.target.value,
              )
            }
            rows={6}
            style={fieldStyle}
            placeholder="Exact acceptance conditions"
            disabled={busy}
          />
        </label>

        <div
          style={{
            marginTop: 22,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="submit"
            disabled={busy}
            style={{
              border: 0,
              borderRadius: 10,
              padding: "11px 16px",
              font: "inherit",
              fontWeight: 700,
              cursor: busy
                ? "not-allowed"
                : "pointer",
            }}
          >
            {busy
              ? "Authorizing…"
              : "Authorize & Dispatch"}
          </button>

          <span style={{ opacity: 0.68, fontSize: 13 }}>
            No automatic retry after an ambiguous write failure.
          </span>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 10,
              border: "1px solid rgba(248, 113, 113, 0.45)",
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </div>
        ) : null}

        {result ? (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 10,
              border: "1px solid rgba(74, 222, 128, 0.35)",
              display: "grid",
              gap: 6,
            }}
          >
            <strong>Admission confirmed</strong>
            <span>taskId={result.taskId}</span>
            <span>taskStatus={result.taskStatus}</span>
            <span>executionId={result.executionId}</span>
            <span>executionStatus={result.executionStatus}</span>
          </div>
        ) : null}
      </form>
    </main>
  );
}
