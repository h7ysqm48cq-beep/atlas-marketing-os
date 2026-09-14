import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule(): Promise<Record<string, unknown>> {
  try {
    return (await import('./supervisor-client.ts')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const assignment = {
  executionId: 'exec-1',
  taskId: 'task-1',
  workerRole: 'engineering',
  executionPurpose: 'IMPLEMENTATION',
  objective: 'Implement runner',
  allowedPaths: ['apps/example.ts'],
  forbiddenActions: ['merge', 'deploy_production'],
  dependencies: [],
  acceptance: ['tests pass'],
  requiredEvidence: [],
};

const execution = {
  id: assignment.executionId,
  taskId: assignment.taskId,
  workerRole: assignment.workerRole,
  status: 'RUNNING',
  assignment,
};

const result = {
  summary: 'done',
  evidence: {
    rootCause: 'implemented',
    changedFiles: ['apps/example.ts'],
    tests: ['PASS'],
    build: 'PASS',
    regression: [],
    deploymentState: 'NOT_DEPLOYED',
    gitState: 'BRANCH_ONLY',
    remainingRisk: [],
  },
};

test('SupervisorClient treats 204 claim-next as no work', async () => {
  const mod = await loadModule();
  const Client = mod.SupervisorClient as
    | (new (options: Record<string, unknown>) => { claimNext(): Promise<unknown> })
    | undefined;
  assert.ok(Client, 'SupervisorClient must exist');

  const client = new Client({
    baseUrl: 'https://api.example.test',
    bootstrapToken: 'bootstrap-secret',
    fetch: async () => new Response(null, { status: 204 }),
  });

  assert.equal(await client.claimNext(), null);
});

test('SupervisorClient never exposes bootstrap or execution capability on the claimed session', async () => {
  const mod = await loadModule();
  const Client = mod.SupervisorClient as
    | (new (options: Record<string, unknown>) => { claimNext(): Promise<Record<string, unknown> | null> })
    | undefined;
  assert.ok(Client, 'SupervisorClient must exist');

  const calls: Array<{ url: string; authorization?: string }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get('authorization') ?? undefined });
    return new Response(
      JSON.stringify({ execution, assignment, capability: 'capability-secret' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const client = new Client({
    baseUrl: 'https://api.example.test',
    bootstrapToken: 'bootstrap-secret',
    fetch,
  });
  const session = await client.claimNext();

  assert.ok(session);
  assert.equal('capability' in session, false);
  assert.equal(JSON.stringify(session).includes('capability-secret'), false);
  assert.equal(JSON.stringify(session).includes('bootstrap-secret'), false);
  assert.equal(calls[0]?.authorization, 'Bearer bootstrap-secret');
});

test('SupervisorClient routes independent verification through verifier transport', async () => {
  const mod = await loadModule();
  const Client = mod.SupervisorClient as
    | (new (options: Record<string, unknown>) => { claimNext(): Promise<any> })
    | undefined;
  assert.ok(Client, 'SupervisorClient must exist');

  const urls: string[] = [];
  const verificationAssignment = {
    ...assignment,
    executionPurpose: 'INDEPENDENT_VERIFICATION',
  };
  let claim = true;
  const fetch = async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (claim) {
      claim = false;
      return new Response(
        JSON.stringify({
          execution: { ...execution, assignment: verificationAssignment },
          assignment: verificationAssignment,
          capability: 'verifier-capability',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(execution), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const client = new Client({
    baseUrl: 'https://api.example.test',
    bootstrapToken: 'bootstrap-secret',
    fetch,
  });
  const session = await client.claimNext();
  await session.heartbeat();
  await session.complete(result);

  assert.ok(urls.some((url) => url.includes('/engineering/supervisor/verifier/')));
  assert.ok(urls.some((url) => url.endsWith('/verification')));
});

test('ambiguous completion performs one read-only reconciliation and never retries mutation', async () => {
  const mod = await loadModule();
  const Client = mod.SupervisorClient as
    | (new (options: Record<string, unknown>) => { claimNext(): Promise<any> })
    | undefined;
  const Ambiguous = mod.AmbiguousSupervisorMutationError as
    | (new (...args: unknown[]) => Error)
    | undefined;
  assert.ok(Client, 'SupervisorClient must exist');
  assert.ok(Ambiguous, 'AmbiguousSupervisorMutationError must exist');

  let claim = true;
  let completePosts = 0;
  let assignmentReads = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (claim) {
      claim = false;
      return new Response(
        JSON.stringify({ execution, assignment, capability: 'worker-capability' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.endsWith('/complete') && init?.method === 'POST') {
      completePosts += 1;
      throw new TypeError('network disconnected after request');
    }
    if (url.endsWith('/assignment') && init?.method === 'GET') {
      assignmentReads += 1;
      return new Response(JSON.stringify(assignment), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected request:${url}`);
  };

  const client = new Client({
    baseUrl: 'https://api.example.test',
    bootstrapToken: 'bootstrap-secret',
    fetch,
  });
  const session = await client.claimNext();

  await assert.rejects(() => session.complete(result), Ambiguous);
  assert.equal(completePosts, 1);
  assert.equal(assignmentReads, 1);
});
