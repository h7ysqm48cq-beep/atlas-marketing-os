import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import type {
  SupervisorGateDecision,
  ValidateWorkerContextInput,
} from '../agent-supervisor.types';
import {
  SUPERVISOR_EXECUTION_STORE,
  type SupervisorExecutionStore,
} from '../stores/supervisor-execution.store';

const ACTIVE_IMPLEMENTATION_STATUSES = new Set(['DISPATCHED', 'RUNNING']);

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

    const execution = await this.executionStore.get(input.executionId);
    if (!execution) {
      throw new NotFoundException({ code: 'execution_not_found' });
    }
    if (execution.taskId !== task.id) {
      throw new BadRequestException({ code: 'execution_task_mismatch' });
    }
    if (!ACTIVE_IMPLEMENTATION_STATUSES.has(execution.status)) {
      throw new BadRequestException({
        code: 'execution_not_active',
        current: execution.status,
      });
    }

    if (!(await this.supervisor.ownsAllowedPaths(task.id))) {
      throw new BadRequestException({ code: 'file_ownership_missing' });
    }

    const changedFiles = (input.changedFiles ?? []).map((path) =>
      this.normalizeRepoPath(path),
    );
    const allowedPaths = execution.assignment.allowedPaths.map((path) =>
      this.normalizeAllowedPath(path),
    );

    for (const changedFile of changedFiles) {
      if (!allowedPaths.some((allowed) => this.pathMatches(allowed, changedFile))) {
        throw new BadRequestException({
          code: 'changed_file_out_of_scope',
          path: changedFile,
        });
      }
    }

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

    return {
      allowed: true,
      reason: null,
      taskId: task.id,
      executionId: execution.id,
    };
  }

  private normalizeAllowedPath(path: string) {
    const trailingSlash = path.trim().endsWith('/');
    const normalized = this.normalizeRepoPath(path);
    return trailingSlash ? `${normalized}/` : normalized;
  }

  private normalizeRepoPath(path: string) {
    const normalized = path.trim().replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    const segments = normalized.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new BadRequestException({ code: 'invalid_repo_path' });
    }

    return normalized;
  }

  private pathMatches(allowed: string, changed: string) {
    return allowed.endsWith('/')
      ? changed.startsWith(allowed)
      : changed === allowed;
  }
}
