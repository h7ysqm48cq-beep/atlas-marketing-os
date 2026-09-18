import type {
  ClaimedExecutionSession,
  ExecutionPurpose,
  WorkerAssignment,
  WorkerExecutionResult,
} from './types.ts';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SupervisorClientOptions {
  baseUrl: string;
  bootstrapToken: string;
  executionPurpose?: ExecutionPurpose;
  fetch?: FetchLike;
}

interface ClaimResponse {
  execution?: unknown;
  assignment: WorkerAssignment;
  capability: string;
}

export class AmbiguousSupervisorMutationError extends Error {
  readonly ambiguous = true;

  constructor(operation: string, cause?: unknown) {
    super(`supervisor_mutation_ambiguous:${operation}`);
    this.name = 'AmbiguousSupervisorMutationError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function assertAssignment(value: unknown): asserts value is WorkerAssignment {
  if (!value || typeof value !== 'object') {
    throw new Error('supervisor_assignment_invalid');
  }
  const assignment = value as Record<string, unknown>;
  if (
    typeof assignment.executionId !== 'string' ||
    !assignment.executionId ||
    typeof assignment.taskId !== 'string' ||
    !assignment.taskId ||
    typeof assignment.workerRole !== 'string' ||
    !Array.isArray(assignment.allowedPaths) ||
    !assignment.allowedPaths.every((path) => typeof path === 'string')
  ) {
    throw new Error('supervisor_assignment_invalid');
  }
}

async function decodeJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('supervisor_response_invalid_json');
  }
}

export class SupervisorClient {
  private readonly baseUrl: string;
  private readonly bootstrapToken: string;
  private readonly executionPurpose: ExecutionPurpose;
  private readonly fetcher: FetchLike;

  constructor(options: SupervisorClientOptions) {
    if (!options.baseUrl || !options.bootstrapToken) {
      throw new Error('supervisor_client_configuration_invalid');
    }
    this.baseUrl = trimSlash(options.baseUrl);
    this.bootstrapToken = options.bootstrapToken;
    this.executionPurpose = options.executionPurpose ?? 'IMPLEMENTATION';
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async claimNext(): Promise<ClaimedExecutionSession | null> {
    const response = await this.fetcher(
      `${this.baseUrl}/engineering/supervisor/worker/claim-next`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.bootstrapToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ executionPurpose: this.executionPurpose }),
      },
    );

    if (response.status === 204) return null;
    if (!response.ok) {
      throw new Error(`supervisor_claim_failed:${response.status}`);
    }

    const decoded = (await decodeJson(response)) as ClaimResponse | undefined;
    if (
      !decoded ||
      typeof decoded.capability !== 'string' ||
      !decoded.capability
    ) {
      throw new Error('supervisor_claim_response_invalid');
    }
    assertAssignment(decoded.assignment);

    const assignment = decoded.assignment;
    const purpose: ExecutionPurpose =
      assignment.executionPurpose === 'INDEPENDENT_VERIFICATION'
        ? 'INDEPENDENT_VERIFICATION'
        : 'IMPLEMENTATION';
    if (purpose !== this.executionPurpose) {
      throw new Error('supervisor_claim_purpose_mismatch');
    }
    const plane =
      purpose === 'INDEPENDENT_VERIFICATION' ? 'verifier' : 'worker';
    const route = `${this.baseUrl}/engineering/supervisor/${plane}/tasks/${encodeURIComponent(assignment.taskId)}/executions/${encodeURIComponent(assignment.executionId)}`;
    const capability = decoded.capability;

    const readAssignment = async (): Promise<unknown> => {
      const read = await this.fetcher(`${route}/assignment`, {
        method: 'GET',
        headers: { authorization: `Bearer ${capability}` },
      });
      if (!read.ok) {
        throw new Error(`supervisor_assignment_read_failed:${read.status}`);
      }
      return decodeJson(read);
    };

    const mutate = async (
      operation: string,
      suffix: string,
      body: unknown,
    ): Promise<unknown> => {
      let mutationResponse: Response;
      try {
        mutationResponse = await this.fetcher(`${route}/${suffix}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${capability}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        try {
          await readAssignment();
        } catch {
          // Reconciliation is deliberately best-effort and read-only.
        }
        throw new AmbiguousSupervisorMutationError(operation, error);
      }

      if (!mutationResponse.ok) {
        throw new Error(`supervisor_${operation}_failed:${mutationResponse.status}`);
      }
      return decodeJson(mutationResponse);
    };

    const session: ClaimedExecutionSession = {
      assignment,
      purpose,
      heartbeat: () => mutate('heartbeat', 'heartbeat', {}),
      complete: (result: WorkerExecutionResult) =>
        mutate(
          'complete',
          purpose === 'INDEPENDENT_VERIFICATION' ? 'verification' : 'complete',
          result,
        ),
      fail: (reason: string) => mutate('fail', 'fail', { error: reason }),
      cancel: (reason: string) =>
        mutate('cancel', 'cancel', { reason }),
    };

    return Object.freeze(session);
  }
}
