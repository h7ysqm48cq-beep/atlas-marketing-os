import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  IntegrationGateInput,
  SupervisorGateDecision,
  SupervisorTask,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import type { SupervisorExecution } from '../execution/supervisor-execution.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

const ACTIVE_IMPLEMENTATION_STATUSES = new Set(['DISPATCHED', 'RUNNING']);
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

@Injectable()
export class AgentGatewayService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    @Inject(SUPERVISOR_EXECUTION_STORE)
    private readonly executionStore: SupervisorExecutionStore,
  ) {}

  async validateWorkerContext(
    input: ValidateWorkerContextInput,
  ): Promise<SupervisorGateDecision> {
    const task = await this.supervisor.getTask(input.taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_implementation_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, input.executionId);
    if (!ACTIVE_IMPLEMENTATION_STATUSES.has(execution.status)) {
      throw new BadRequestException({
        code: 'execution_not_active',
        current: execution.status,
      });
    }

    if (!(await this.supervisor.ownsAllowedPaths(task.id))) {
      throw new BadRequestException({ code: 'file_ownership_missing' });
    }

    this.validateChangedFiles(
      execution.assignment.allowedPaths,
      input.changedFiles ?? [],
    );

    if (input.requestedAction) {
      if (execution.assignment.forbiddenActions.includes(input.requestedAction)) {
        throw new BadRequestException({
          code: 'worker_protected_action_denied',
        });
      }

      const permission = this.supervisor.checkPermission(
        execution.workerRole,
        input.requestedAction,
        {
          taskScopeIncludesAction: true,
          supervisorAuthorization: true,
        },
      );
      if (!permission.allowed) {
        throw new BadRequestException({
          code: permission.reason ?? 'permission_denied',
        });
      }
    }

    return this.allowed(task.id, execution.id);
  }

  async submitImplementationFromExecution(
    taskId: string,
    executionId: string,
  ): Promise<SupervisorTask> {
    const task = await this.supervisor.getTask(taskId);
    if (task.status !== 'WORKING') {
      throw new BadRequestException({
        code: 'task_not_implementation_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, executionId);
    if (execution.status !== 'COMPLETED' || !execution.result) {
      throw new BadRequestException({
        code: 'execution_not_completed',
        current: execution.status,
      });
    }

    this.validateChangedFiles(
      execution.assignment.allowedPaths,
      execution.result.evidence.changedFiles,
    );

    return this.supervisor.submitImplementation(
      task.id,
      execution.result.evidence,
    );
  }

  async checkReviewCandidate(
    input: IntegrationGateInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution } = await this.validateIntegrationCandidate(input);
    return this.allowed(task.id, execution.id);
  }

  async checkIntegration(
    input: IntegrationGateInput,
  ): Promise<SupervisorGateDecision> {
    const { task, execution } = await this.validateIntegrationCandidate(input);

    if (!input.explicitUserAuthorization) {
      throw new BadRequestException({
        code: 'explicit_user_authorization_required',
      });
    }

    const permission = this.supervisor.checkPermission(
      'supervisor',
      input.action,
      {
        explicitUserAuthorization: true,
        supervisorAuthorization: true,
        taskScopeIncludesAction: true,
      },
    );
    if (!permission.allowed) {
      throw new BadRequestException({
        code: permission.reason ?? 'permission_denied',
      });
    }

    return this.allowed(task.id, execution.id);
  }

  private async validateIntegrationCandidate(input: IntegrationGateInput) {
    const task = await this.supervisor.getTask(input.taskId);
    if (!['READY_FOR_REVIEW', 'APPROVED'].includes(task.status)) {
      throw new BadRequestException({
        code: 'task_not_integration_ready',
        current: task.status,
      });
    }

    const execution = await this.requireExecution(task, input.executionId);
    if (execution.status !== 'COMPLETED' || !execution.result) {
      throw new BadRequestException({
        code: 'execution_not_completed',
        current: execution.status,
      });
    }

    this.validateChangedFiles(execution.assignment.allowedPaths, input.changedFiles);
    this.validateSha(input.baseSha, 'invalid_base_sha');
    this.validateSha(input.headSha, 'invalid_head_sha');

    if (input.action === 'merge' && input.targetBranch !== 'production/atlas') {
      throw new BadRequestException({ code: 'canonical_target_required' });
    }

    return { task, execution };
  }

  private async requireExecution(
    task: SupervisorTask,
    executionId: string,
  ): Promise<SupervisorExecution> {
    const execution = await this.executionStore.get(executionId);
    if (!execution) {
      throw new NotFoundException({ code: 'execution_not_found' });
    }
    if (execution.taskId !== task.id) {
      throw new BadRequestException({ code: 'execution_task_mismatch' });
    }
    return execution;
  }

  private validateChangedFiles(allowedPaths: string[], changedFiles: string[]) {
    const normalizedAllowed = allowedPaths.map((path) =>
      this.normalizeAllowedPath(path),
    );
    const normalizedChanged = changedFiles.map((path) =>
      this.normalizeRepoPath(path),
    );

    for (const changedFile of normalizedChanged) {
      if (
        !normalizedAllowed.some((allowed) =>
          this.pathMatches(allowed, changedFile),
        )
      ) {
        throw new BadRequestException({
          code: 'changed_file_out_of_scope',
          path: changedFile,
        });
      }
    }
  }

  private validateSha(value: string | undefined, code: string) {
    if (value !== undefined && !FULL_GIT_SHA.test(value)) {
      throw new BadRequestException({ code });
    }
  }

  private normalizeAllowedPath(path: string) {
    const trimmed = path.trim().replace(/\\/g, '/');
    const trailingSlash = trimmed.endsWith('/');
    const base = trailingSlash ? trimmed.slice(0, -1) : trimmed;
    const normalized = this.normalizeRepoPath(base);
    return trailingSlash ? `${normalized}/` : normalized;
  }

  private normalizeRepoPath(path: string) {
    const normalized = path.trim().replace(/\\/g, '/');
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized)
    ) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    const segments = normalized.split('/');
    if (
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    ) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    return normalized;
  }

  private pathMatches(allowed: string, changed: string) {
    return allowed.endsWith('/')
      ? changed.startsWith(allowed)
      : changed === allowed;
  }

  private allowed(taskId: string, executionId: string): SupervisorGateDecision {
    return {
      allowed: true,
      reason: null,
      taskId,
      executionId,
    };
  }
}
