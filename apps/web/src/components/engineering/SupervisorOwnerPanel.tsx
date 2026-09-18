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

type DeploymentCandidate = {
  action: "deploy_production";
  targetBranch: "production/atlas";
  baseSha: string;
  headSha: string;
  changedFiles: string[];
};

export type SupervisorAdmissionResult = {
  taskId: string;
  taskStatus: string;
  executionId: string | null;
  executionStatus: string | null;
};

export type SupervisorAdmissionOptions = {
  frozenBaseSha?: string;
};

const STALE_BROWSER_WORKER_RELEASE_REASON =
  "Release stale browser-worker production deployment ownership before resuming the authorized deployment flow.";

export class SupervisorAdmissionError extends Error {
  constructor(
    message: string,
    readonly partialResult: SupervisorAdmissionResult,
  ) {
    super(message);
    this.name = "SupervisorAdmissionError";
  }
}
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

async function getSupervisor(
  stage: string,
  path: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let response:
    Awaited<ReturnType<FetchLike>>;

  try {
    response = await fetchImpl(
      `${SUPERVISOR_API}${path}`,
      {
        method: "GET",
        credentials: "same-origin",
        headers: {
          [OWNER_ACTION_HEADER]: "1",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "network failure";

    throw new Error(
      `${stage} request failed: ${message}`,
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
  options: SupervisorAdmissionOptions = {},
): Promise<SupervisorAdmissionResult> {
  const frozenBaseSha =
    options.frozenBaseSha?.trim().toLowerCase() ?? "";

  if (
    frozenBaseSha &&
    !/^[0-9a-f]{40}$/u.test(frozenBaseSha)
  ) {
    throw new Error(
      "Frozen base SHA must be exactly 40 hexadecimal characters.",
    );
  }

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

  let started: unknown;

  try {
    started = await postSupervisor(
      "start task",
      `/tasks/${encodeURIComponent(taskId)}/start`,
      {},
      fetchImpl,
    );
  } catch (error) {
    throw new SupervisorAdmissionError(
      error instanceof Error
        ? error.message
        : "start task failed.",
      {
        taskId,
        taskStatus: "CREATED",
        executionId: null,
        executionStatus: null,
      },
    );
  }

  const startedRecord = asRecord(started);

  if (
    startedRecord?.id !== taskId ||
    startedRecord?.status !== "WORKING"
  ) {
    throw new SupervisorAdmissionError(
      "start task response did not confirm the same task in WORKING state. Stop before dispatch.",
      {
        taskId,
        taskStatus:
          typeof startedRecord?.status === "string"
            ? startedRecord.status
            : "UNKNOWN",
        executionId: null,
        executionStatus: null,
      },
    );
  }

  let dispatched: unknown;

  try {
    dispatched = await postSupervisor(
      "dispatch execution",
      `/tasks/${encodeURIComponent(taskId)}/dispatch`,
      frozenBaseSha
        ? { frozenBaseSha }
        : {},
      fetchImpl,
    );
  } catch (error) {
    throw new SupervisorAdmissionError(
      error instanceof Error
        ? error.message
        : "dispatch execution failed.",
      {
        taskId,
        taskStatus: "WORKING",
        executionId: null,
        executionStatus: null,
      },
    );
  }

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
    !["QUEUED", "DISPATCHED"].includes(
      typeof executionStatus === "string"
        ? executionStatus
        : "",
    )
  ) {
    throw new SupervisorAdmissionError(
      "dispatch response did not confirm a QUEUED or DISPATCHED execution. Stop and verify Supervisor state.",
      {
        taskId,
        taskStatus: "WORKING",
        executionId:
          typeof executionId === "string"
            ? executionId
            : null,
        executionStatus:
          typeof executionStatus === "string"
            ? executionStatus
            : null,
      },
    );
  }

  return {
    taskId,
    taskStatus: "WORKING",
    executionId,
    executionStatus:
      executionStatus as "QUEUED" | "DISPATCHED",
  };
}

export async function getSupervisorStatus(
  taskId: string,
  executionId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<SupervisorAdmissionResult> {
  const encodedTaskId = encodeURIComponent(taskId);
  const task = asRecord(
    await getSupervisor(
      "read task status",
      `/tasks/${encodedTaskId}`,
      fetchImpl,
    ),
  );

  if (!task || typeof task.status !== "string") {
    throw new Error(
      "read task status response is missing status.",
    );
  }

  let resolvedExecutionId = executionId;
  let resolvedExecutionStatus: string | null = null;

  if (!resolvedExecutionId) {
    const listed = await getSupervisor(
      "read task executions",
      `/tasks/${encodedTaskId}/executions`,
      fetchImpl,
    );
    const executions = Array.isArray(listed)
      ? listed
      : asRecord(listed)?.executions;
    const latest = Array.isArray(executions)
      ? asRecord(executions.at(-1))
      : null;

    if (typeof latest?.id === "string") {
      resolvedExecutionId = latest.id;
      resolvedExecutionStatus =
        typeof latest.status === "string"
          ? latest.status
          : null;
    }
  }

  if (resolvedExecutionId) {
    const execution = asRecord(
      await getSupervisor(
        "read execution status",
        `/executions/${encodeURIComponent(resolvedExecutionId)}`,
        fetchImpl,
      ),
    );

    if (typeof execution?.status === "string") {
      resolvedExecutionStatus = execution.status;
    }
  }

  return {
    taskId,
    taskStatus: task.status,
    executionId: resolvedExecutionId,
    executionStatus: resolvedExecutionStatus,
  };
}

function hasString(
  value: unknown,
  expected: string,
): boolean {
  return typeof value === "string" && value === expected;
}

function hasStringInArray(
  value: unknown,
  expected: string,
): boolean {
  return (
    Array.isArray(value) &&
    value.some((entry) => hasString(entry, expected))
  );
}

function hasPathPrefixInArray(
  value: unknown,
  prefix: string,
): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (entry) =>
        typeof entry === "string" &&
        entry.startsWith(prefix),
    )
  );
}

function asDeploymentCandidate(
  value: unknown,
): DeploymentCandidate | null {
  const candidate = asRecord(value);
  const changedFiles = candidate?.changedFiles;

  if (
    candidate?.action !== "deploy_production" ||
    candidate?.targetBranch !== "production/atlas" ||
    typeof candidate.baseSha !== "string" ||
    typeof candidate.headSha !== "string" ||
    !Array.isArray(changedFiles) ||
    changedFiles.some(
      (file) => typeof file !== "string" || !file.trim(),
    )
  ) {
    return null;
  }

  return {
    action: "deploy_production",
    targetBranch: "production/atlas",
    baseSha: candidate.baseSha,
    headSha: candidate.headSha,
    changedFiles: [...changedFiles] as string[],
  };
}

function sameDeploymentCandidate(
  left: DeploymentCandidate,
  right: DeploymentCandidate,
): boolean {
  return (
    left.action === right.action &&
    left.targetBranch === right.targetBranch &&
    left.baseSha === right.baseSha &&
    left.headSha === right.headSha &&
    JSON.stringify([...left.changedFiles].sort()) ===
      JSON.stringify([...right.changedFiles].sort())
  );
}

export function findEligibleBrowserWorkerDeploymentCandidate(
  tasks: unknown[],
): { task: JsonRecord; candidate: DeploymentCandidate } {
  const candidates = tasks.flatMap((value) => {
    const task = asRecord(value);
    const evidence = asRecord(task?.evidence);
    const candidate = asDeploymentCandidate(
      evidence?.reviewCandidate,
    );

    if (
      !task ||
      !hasString(task.status, "APPROVED") ||
      typeof task.id !== "string" ||
      !candidate ||
      !hasPathPrefixInArray(
        candidate.changedFiles,
        "apps/browser-worker/",
      )
    ) {
      return [];
    }

    return [{ task, candidate }];
  });

  if (candidates.length === 0) {
    throw new Error(
      "No approved browser-worker production deployment candidate was found.",
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      "More than one approved browser-worker production deployment candidate was found. Stop and review them manually.",
    );
  }

  return candidates[0];
}

export async function authorizeEligibleBrowserWorkerDeployment(
  fetchImpl: FetchLike = fetch,
): Promise<SupervisorAdmissionResult> {
  const listed = await getSupervisor(
    "list Supervisor tasks",
    "/tasks",
    fetchImpl,
  );
  const tasks = Array.isArray(listed)
    ? listed
    : asRecord(listed)?.tasks;

  if (!Array.isArray(tasks)) {
    throw new Error(
      "list Supervisor tasks response is missing tasks.",
    );
  }

  const { task, candidate } =
    findEligibleBrowserWorkerDeploymentCandidate(tasks);
  const taskId = requireStringField(
    task,
    "id",
    "browser-worker deployment candidate",
  );
  const listedExecutions = await getSupervisor(
    "list candidate executions",
    `/tasks/${encodeURIComponent(taskId)}/executions`,
    fetchImpl,
  );
  const executions = Array.isArray(listedExecutions)
    ? listedExecutions
    : asRecord(listedExecutions)?.executions;
  const matchingExecutions = Array.isArray(executions)
    ? executions.filter((value) => {
        const execution = asRecord(value);
        const evidence = asRecord(execution?.evidence);
        const executionCandidate =
          asDeploymentCandidate(evidence?.reviewCandidate);

        return (
          hasString(execution?.status, "COMPLETED") &&
          Boolean(
            executionCandidate &&
              sameDeploymentCandidate(
                candidate,
                executionCandidate,
              ),
          )
        );
      })
    : [];

  if (matchingExecutions.length === 0) {
    throw new Error(
      "The approved browser-worker candidate has no matching completed execution.",
    );
  }

  if (matchingExecutions.length > 1) {
    throw new Error(
      "The approved browser-worker candidate has multiple matching completed executions. Stop and review them manually.",
    );
  }

  const executionId = requireStringField(
    matchingExecutions[0],
    "id",
    "browser-worker deployment execution",
  );
  await postSupervisor(
    "authorize browser-worker production deployment",
    `/tasks/${encodeURIComponent(taskId)}/authorize-production-deployment`,
    { candidate, service: "browser-worker" },
    fetchImpl,
  );

  return {
    taskId,
    taskStatus: "APPROVED",
    executionId,
    executionStatus: "COMPLETED",
  };
}

export function findStaleBrowserWorkerTask(
  tasks: unknown[],
): JsonRecord {
  const candidates = tasks.filter((candidate) => {
    const task = asRecord(candidate);

    return Boolean(
      task &&
      hasString(task.status, "WORKING") &&
      typeof task.id === "string" &&
      typeof task.objective === "string" &&
      task.objective.toLowerCase().includes("browser-worker") &&
      task.objective.toLowerCase().includes("production") &&
      hasStringInArray(
        task.allowedPaths,
        "apps/browser-worker/**",
      ),
    );
  });

  if (candidates.length === 0) {
    throw new Error(
      "No stale browser-worker production task was found.",
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      "More than one stale browser-worker production task was found. Stop and review them manually.",
    );
  }

  return asRecord(candidates[0]) as JsonRecord;
}

export async function recoverStaleBrowserWorkerTask(
  fetchImpl: FetchLike = fetch,
): Promise<SupervisorAdmissionResult> {
  const listed = await getSupervisor(
    "list Supervisor tasks",
    "/tasks",
    fetchImpl,
  );
  const tasks = Array.isArray(listed)
    ? listed
    : asRecord(listed)?.tasks;

  if (!Array.isArray(tasks)) {
    throw new Error(
      "list Supervisor tasks response is missing tasks.",
    );
  }

  const staleTask = findStaleBrowserWorkerTask(tasks);
  const taskId = requireStringField(
    staleTask,
    "id",
    "stale browser-worker task",
  );
  const released = asRecord(
    await postSupervisor(
      "release stale browser-worker task",
      `/tasks/${encodeURIComponent(taskId)}/fail`,
      { reason: STALE_BROWSER_WORKER_RELEASE_REASON },
      fetchImpl,
    ),
  );

  if (!hasString(released?.status, "FAILED")) {
    throw new Error(
      "Supervisor did not confirm stale task release. Stop before redeploying.",
    );
  }

  return {
    taskId,
    taskStatus: "FAILED",
    executionId: null,
    executionStatus: null,
  };
}

const STANDARD_OBJECTIVE =
  "Make Supervisor Admission one-click and recoverable: preserve task and execution IDs after partial failures, and refresh persisted status without duplicate dispatch.";

const STANDARD_ALLOWED_PATHS = [
  "apps/web/src/components/engineering/SupervisorOwnerPanel.tsx",
  "apps/web/tests/supervisor-owner.spec.ts",
].join("\n");

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

const STANDARD_ACCEPTANCE = [
  "Standard flow requires no manual task ID or dependency entry",
  "Task ID and execution ID are preserved after create/start/dispatch partial failure",
  "A Refresh status control reads the existing task and execution state",
  "Submitting a failed start never creates or dispatches a duplicate task",
  "Recovery releases only one uniquely matched stale browser-worker production task",
  "Web lint and focused Playwright coverage pass",
  "No files outside the two allowed paths are modified",
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
    useState(STANDARD_OBJECTIVE);
  const [owner, setOwner] =
    useState<WorkerOwner>("frontend");
  const [frozenBaseSha, setFrozenBaseSha] =
    useState("");
  const [allowedPathsText, setAllowedPathsText] =
    useState(STANDARD_ALLOWED_PATHS);
  const [forbiddenActionsText, setForbiddenActionsText] =
    useState(DEFAULT_FORBIDDEN);
  const [acceptanceText, setAcceptanceText] =
    useState(STANDARD_ACCEPTANCE);
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [result, setResult] =
    useState<SupervisorAdmissionResult | null>(null);
  const [recovery, setRecovery] =
    useState<SupervisorAdmissionResult | null>(null);
  const [deploymentAuthorization, setDeploymentAuthorization] =
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

    if (result) {
      setError(
        "已有 task 状态记录。请刷新状态，不要重复创建。",
      );
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
        dependsOnText: "",
        acceptanceText,
      });

      const admission =
        await runSupervisorAdmission(
          input,
          fetch,
          { frozenBaseSha },
        );

      setResult(admission);
    } catch (caught) {
      if (caught instanceof SupervisorAdmissionError) {
        setResult(caught.partialResult);
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "Supervisor admission failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!result || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      setResult(
        await getSupervisorStatus(
          result.taskId,
          result.executionId,
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Status refresh failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recoverStaleTask() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setRecovery(null);

    try {
      setRecovery(
        await recoverStaleBrowserWorkerTask(),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Stale task recovery failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function authorizeBrowserWorkerDeployment() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    setDeploymentAuthorization(null);

    try {
      setDeploymentAuthorization(
        await authorizeEligibleBrowserWorkerDeployment(),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Production candidate authorization failed.",
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
          Frozen base SHA — optional
          <input
            value={frozenBaseSha}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setFrozenBaseSha(event.target.value)
            }
            spellCheck={false}
            autoComplete="off"
            style={fieldStyle}
            placeholder="40-character Git commit SHA"
            disabled={busy}
          />
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

        <div style={{ ...labelStyle, opacity: 0.72 }}>
          Dependencies
          <span>自动管理，无需输入 task ID。</span>
        </div>

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
            disabled={busy || Boolean(result)}
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

          <button
            type="button"
            onClick={refreshStatus}
            disabled={busy || !result}
            style={{
              border: "1px solid rgba(148, 163, 184, 0.45)",
              borderRadius: 10,
              padding: "10px 14px",
              font: "inherit",
              fontWeight: 700,
              cursor: busy || !result
                ? "not-allowed"
                : "pointer",
            }}
          >
            {busy ? "Refreshing…" : "Refresh status"}
          </button>

          <button
            type="button"
            onClick={recoverStaleTask}
            disabled={busy}
            style={{
              border: "1px solid rgba(248, 113, 113, 0.55)",
              borderRadius: 10,
              padding: "10px 14px",
              font: "inherit",
              fontWeight: 700,
              cursor: busy
                ? "not-allowed"
                : "pointer",
            }}
          >
            {busy
              ? "Recovering…"
              : "Recover stale worker task"}
          </button>

          <button
            type="button"
            onClick={authorizeBrowserWorkerDeployment}
            disabled={busy}
            style={{
              border: "1px solid rgba(96, 165, 250, 0.55)",
              borderRadius: 10,
              padding: "10px 14px",
              font: "inherit",
              fontWeight: 700,
              cursor: busy
                ? "not-allowed"
                : "pointer",
            }}
          >
            {busy
              ? "Checking candidate…"
              : "Authorize browser-worker candidate"}
          </button>

          <span style={{ opacity: 0.68, fontSize: 13 }}>
            Task/execution IDs are kept after a partial failure; refresh never creates a duplicate.
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

        {recovery ? (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 10,
              border: "1px solid rgba(250, 204, 21, 0.45)",
              display: "grid",
              gap: 6,
            }}
          >
            <strong>Stale task ownership released</strong>
            <span>taskId={recovery.taskId}</span>
            <span>taskStatus={recovery.taskStatus}</span>
            <span>Next: create a properly approved production deployment candidate before retrying Railway.</span>
          </div>
        ) : null}

        {deploymentAuthorization ? (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 10,
              border: "1px solid rgba(96, 165, 250, 0.45)",
              display: "grid",
              gap: 6,
            }}
          >
            <strong>Production candidate authorized</strong>
            <span>taskId={deploymentAuthorization.taskId}</span>
            <span>executionId={deploymentAuthorization.executionId}</span>
            <span>service=browser-worker</span>
            <span>Next: run the separately authorized Railway deployment.</span>
          </div>
        ) : null}
      </form>
    </main>
  );
}
