import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SupervisorExecution,
  WorkerAssignmentEnvelope,
} from '../execution/supervisor-execution.types';
import type {
  SupervisorWorkerCapabilityAuthorizationInput,
  SupervisorWorkerCapabilityClaimsV1,
  SupervisorWorkerCapabilityClaimsV2,
  SupervisorWorkerCapabilityClaims,
  SupervisorWorkerCapabilityMetadata,
  SupervisorWorkerCapabilityOperation,
} from './supervisor-worker-capability.types';

const CAPABILITY_VERSION = 2 as const;
const DEFAULT_TTL_MS = 5 * 60 * 1_000;
const MAX_TTL_MS = 15 * 60 * 1_000;
const KEY_SALT = 'atlas-supervisor-worker-capability:v1';
const KEY_INFO = 'execution-bound-signing';
const DEFAULT_OPERATIONS: SupervisorWorkerCapabilityOperation[] = [
  'read_assignment',
  'mark_running',
  'complete',
  'fail',
  'cancel',
];
const OPERATIONS = new Set<SupervisorWorkerCapabilityOperation>(
  DEFAULT_OPERATIONS,
);

type IssueOptions = {
  now?: Date;
  ttlMs?: number;
  allowedOperations?: SupervisorWorkerCapabilityOperation[];
};

@Injectable()
export class SupervisorWorkerCapabilityService {
  constructor(private readonly config: ConfigService) {}

  issue(
    execution: SupervisorExecution,
    options: IssueOptions = {},
  ): {
    token: string;
    metadata: SupervisorWorkerCapabilityMetadata;
  } {
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new ForbiddenException('worker_capability_invalid_expiry');
    }

    const executionPurpose =
      execution.assignment.executionPurpose ?? 'IMPLEMENTATION';
    if (
      execution.assignment.taskId !== execution.taskId ||
      execution.assignment.executionId !== execution.id ||
      execution.assignment.workerRole !== execution.workerRole
    ) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    if (
      !execution.claimedBy ||
      !Number.isInteger(execution.claimEpoch) ||
      execution.claimEpoch <= 0
    ) {
      throw new ForbiddenException('worker_capability_claim_required');
    }
    if (
      !execution.leaseExpiresAt ||
      now.getTime() >= execution.leaseExpiresAt.getTime()
    ) {
      throw new ForbiddenException('runner_lease_expired');
    }

    const allowedOperations = [
      ...new Set(options.allowedOperations ?? DEFAULT_OPERATIONS),
    ];
    if (
      allowedOperations.length === 0 ||
      allowedOperations.some((operation) => !OPERATIONS.has(operation))
    ) {
      throw new ForbiddenException('worker_capability_operation_denied');
    }

    const metadata: SupervisorWorkerCapabilityMetadata & { version: 2 } = {
      version: CAPABILITY_VERSION,
      assignmentDigest: this.assignmentDigest(execution.assignment),
      allowedOperations,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    const claims: SupervisorWorkerCapabilityClaimsV2 = {
      ...metadata,
      taskId: execution.taskId,
      executionId: execution.id,
      workerRole: execution.workerRole,
      executionPurpose,
      runnerId: execution.claimedBy,
      claimEpoch: execution.claimEpoch,
    };
    return this.encode(claims, metadata);
  }

  issueLegacy(
    execution: SupervisorExecution,
    options: IssueOptions = {},
  ): {
    token: string;
    metadata: SupervisorWorkerCapabilityMetadata;
  } {
    const now = options.now ?? new Date();
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
      throw new ForbiddenException('worker_capability_invalid_expiry');
    }
    const executionPurpose = execution.assignment.executionPurpose ?? 'IMPLEMENTATION';
    if (
      execution.assignment.taskId !== execution.taskId ||
      execution.assignment.executionId !== execution.id ||
      execution.assignment.workerRole !== execution.workerRole
    ) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    const allowedOperations = [
      ...new Set(options.allowedOperations ?? DEFAULT_OPERATIONS),
    ];
    if (
      allowedOperations.length === 0 ||
      allowedOperations.some((operation) => !OPERATIONS.has(operation))
    ) {
      throw new ForbiddenException('worker_capability_operation_denied');
    }
    const metadata: SupervisorWorkerCapabilityMetadata & { version: 1 } = {
      version: 1,
      assignmentDigest: this.assignmentDigest(execution.assignment),
      allowedOperations,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    const claims: SupervisorWorkerCapabilityClaimsV1 = {
      ...metadata,
      taskId: execution.taskId,
      executionId: execution.id,
      workerRole: execution.workerRole,
      executionPurpose,
    };
    return this.encode(claims, metadata);
  }

  private encode(
    claims: SupervisorWorkerCapabilityClaimsV1 | SupervisorWorkerCapabilityClaimsV2,
    metadata: SupervisorWorkerCapabilityMetadata,
  ) {
    const encodedPayload = Buffer.from(
      this.canonicalize(claims),
      'utf8',
    ).toString('base64url');
    const signature = this.sign(encodedPayload).toString('base64url');

    return {
      token: `${encodedPayload}.${signature}`,
      metadata,
    };
  }

  authorize(
    token: string,
    input: SupervisorWorkerCapabilityAuthorizationInput,
  ): SupervisorWorkerCapabilityClaims {
    const claims = this.verify(token);
    const now = input.now ?? new Date();
    if (now.getTime() >= Date.parse(claims.expiresAt)) {
      throw new UnauthorizedException('worker_capability_expired');
    }
    if (claims.taskId !== input.taskId) {
      throw new ForbiddenException('worker_capability_task_mismatch');
    }
    if (claims.executionId !== input.executionId) {
      throw new ForbiddenException('worker_capability_execution_mismatch');
    }
    if (claims.workerRole !== input.workerRole) {
      throw new ForbiddenException('worker_capability_role_mismatch');
    }
    if (claims.executionPurpose !== input.executionPurpose) {
      throw new ForbiddenException('worker_capability_purpose_mismatch');
    }
    if (claims.version === 2) {
      if (
        input.claimedBy !== claims.runnerId ||
        input.claimEpoch !== claims.claimEpoch
      ) {
        throw new ForbiddenException('stale_runner_fenced');
      }
      if (
        !input.leaseExpiresAt ||
        now.getTime() >= input.leaseExpiresAt.getTime()
      ) {
        throw new ForbiddenException('runner_lease_expired');
      }
    }
    if (!claims.allowedOperations.includes(input.operation)) {
      throw new ForbiddenException('worker_capability_operation_denied');
    }

    const metadata = input.assignment.workerCapability;
    const digest = this.assignmentDigest(input.assignment);
    if (
      digest !== claims.assignmentDigest ||
      metadata?.version !== claims.version ||
      metadata?.assignmentDigest !== claims.assignmentDigest ||
      metadata.expiresAt !== claims.expiresAt ||
      metadata.issuedAt !== claims.issuedAt ||
      !this.sameOperations(metadata.allowedOperations, claims.allowedOperations)
    ) {
      throw new ForbiddenException('worker_capability_assignment_mismatch');
    }

    return claims;
  }

  assignmentDigest(assignment: WorkerAssignmentEnvelope): string {
    const boundAssignment = { ...assignment };
    delete boundAssignment.workerCapability;
    return createHash('sha256')
      .update(this.canonicalize(boundAssignment), 'utf8')
      .digest('hex');
  }

  private verify(token: string): SupervisorWorkerCapabilityClaims {
    const parts = token?.split('.') ?? [];
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new UnauthorizedException('worker_capability_malformed');
    }

    const expected = this.sign(parts[0]);
    let supplied: Buffer;
    try {
      supplied = Buffer.from(parts[1], 'base64url');
    } catch {
      throw new UnauthorizedException('worker_capability_invalid_signature');
    }
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new UnauthorizedException('worker_capability_invalid_signature');
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      );
    } catch {
      throw new UnauthorizedException('worker_capability_malformed');
    }
    if (!this.isClaims(candidate)) {
      throw new UnauthorizedException('worker_capability_malformed');
    }
    return candidate;
  }

  private sign(encodedPayload: string): Buffer {
    return createHmac('sha256', this.signingKey())
      .update(encodedPayload, 'utf8')
      .digest();
  }

  private signingKey(): Buffer {
    const source = this.config.get<string>('ATLAS_SUPERVISOR_OWNER_TOKEN');
    if (!source) {
      throw new ServiceUnavailableException(
        'worker_capability_signing_material_unavailable',
      );
    }
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(source, 'utf8'),
        Buffer.from(KEY_SALT, 'utf8'),
        Buffer.from(KEY_INFO, 'utf8'),
        32,
      ),
    );
  }

  private isClaims(value: unknown): value is SupervisorWorkerCapabilityClaims {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const claims = value as Partial<SupervisorWorkerCapabilityClaimsV1> &
      Partial<SupervisorWorkerCapabilityClaimsV2>;
    const common =
      typeof claims.taskId === 'string' &&
      Boolean(claims.taskId) &&
      typeof claims.executionId === 'string' &&
      Boolean(claims.executionId) &&
      typeof claims.workerRole === 'string' &&
      (claims.executionPurpose === 'IMPLEMENTATION' ||
        claims.executionPurpose === 'INDEPENDENT_VERIFICATION') &&
      typeof claims.assignmentDigest === 'string' &&
      /^[0-9a-f]{64}$/u.test(claims.assignmentDigest) &&
      typeof claims.issuedAt === 'string' &&
      Number.isFinite(Date.parse(claims.issuedAt)) &&
      typeof claims.expiresAt === 'string' &&
      Number.isFinite(Date.parse(claims.expiresAt)) &&
      Array.isArray(claims.allowedOperations) &&
      claims.allowedOperations.length > 0 &&
      claims.allowedOperations.every(
        (operation) =>
          typeof operation === 'string' && OPERATIONS.has(operation),
      );
    if (!common) return false;
    if (claims.version === 1) return true;
    return (
      claims.version === CAPABILITY_VERSION &&
      typeof claims.runnerId === 'string' &&
      Boolean(claims.runnerId) &&
      Number.isInteger(claims.claimEpoch) &&
      Number(claims.claimEpoch) > 0
    );
  }

  private sameOperations(
    left: SupervisorWorkerCapabilityOperation[],
    right: SupervisorWorkerCapabilityOperation[],
  ): boolean {
    return (
      left.length === right.length &&
      left.every((operation, index) => operation === right[index])
    );
  }

  private canonicalize(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.canonicalize(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, entry]) =>
            `${JSON.stringify(key)}:${this.canonicalize(entry)}`,
        )
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }
}
