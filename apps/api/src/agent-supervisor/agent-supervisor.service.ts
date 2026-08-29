import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateSupervisorTaskInput,
  PermissionContext,
  PermissionDecision,
  SupervisorAction,
  SupervisorAgentRole,
  SupervisorEvidence,
  SupervisorTask,
  SupervisorTaskStatus,
} from './agent-supervisor.types';

const PROTECTED_INTEGRATION_ACTIONS = new Set<SupervisorAction>([
  'merge',
  'rebase',
  'squash',
  'cherry_pick',
  'auto_merge',
  'force_push',
  'delete_branch_for_integration',
]);

const BASE_ALLOWED_ACTIONS = new Set<SupervisorAction>([
  'read_repo',
  'search_repo',
  'edit_assigned_files',
  'run_tests',
  'run_build',
  'commit_assigned_branch',
]);

@Injectable()
export class AgentSupervisorService {
  private readonly tasks = new Map<string, SupervisorTask>();
  private readonly fileOwners = new Map<string, string>();
  private sequence = 0;

  status() {
    return {
      engine: 'agent-supervisor',
      status: 'ready',
      persistence: 'memory',
      tasks: this.tasks.size,
      lockedFiles: this.fileOwners.size,
    };
  }

  listTasks(): SupervisorTask[] {
    return Array.from(this.tasks.values()).map((task) => this.cloneTask(task));
  }

  getTask(id: string): SupervisorTask {
    return this.cloneTask(this.requireTask(id));
  }

  createTask(input: CreateSupervisorTaskInput): SupervisorTask {
    this.validateCreateInput(input);

    const now = new Date();
    const task: SupervisorTask = {
      id: this.nextTaskId(now),
      objective: input.objective.trim(),
      owner: input.owner,
      status: 'DRAFT',
      allowedPaths: this.unique(input.allowedPaths),
      forbiddenActions: this.unique(input.forbiddenActions),
      dependsOn: this.unique(input.dependsOn),
      acceptance: this.unique(input.acceptance),
      evidence: null,
      blockingReason: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    return this.cloneTask(task);
  }

  startTask(id: string): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['DRAFT', 'BLOCKED']);
    this.assertDependenciesReady(task);
    this.assertFilesAvailable(task);

    task.status = 'WORKING';
    task.blockingReason = null;
    task.failureReason = null;
    task.updatedAt = new Date();
    this.acquireFileOwnership(task);

    return this.cloneTask(task);
  }

  blockTask(id: string, reason: string): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['DRAFT', 'WORKING', 'VERIFYING']);
    if (!reason.trim()) {
      throw new BadRequestException('blocking_reason_required');
    }

    task.status = 'BLOCKED';
    task.blockingReason = reason.trim();
    task.updatedAt = new Date();
    this.releaseFileOwnership(task.id);

    return this.cloneTask(task);
  }

  failTask(id: string, reason: string): SupervisorTask {
    const task = this.requireTask(id);
    if (task.status === 'APPROVED' || task.status === 'FAILED') {
      throw new BadRequestException(`invalid_transition:${task.status}->FAILED`);
    }
    if (!reason.trim()) {
      throw new BadRequestException('failure_reason_required');
    }

    task.status = 'FAILED';
    task.failureReason = reason.trim();
    task.updatedAt = new Date();
    this.releaseFileOwnership(task.id);

    return this.cloneTask(task);
  }

  submitImplementation(
    id: string,
    evidence: SupervisorEvidence,
  ): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['WORKING']);
    this.validateEvidence(task, evidence);

    task.evidence = {
      ...evidence,
      changedFiles: this.unique(evidence.changedFiles),
      tests: this.unique(evidence.tests),
      regression: this.unique(evidence.regression),
      remainingRisk: this.unique(evidence.remainingRisk),
    };
    task.status = 'IMPLEMENTED';
    task.updatedAt = new Date();

    return this.cloneTask(task);
  }

  beginVerification(id: string): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['IMPLEMENTED']);
    if (!task.evidence) {
      throw new BadRequestException('implementation_evidence_required');
    }

    task.status = 'VERIFYING';
    task.updatedAt = new Date();
    return this.cloneTask(task);
  }

  returnToWorking(id: string, reason: string): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['IMPLEMENTED', 'VERIFYING', 'READY_FOR_REVIEW']);
    if (!reason.trim()) {
      throw new BadRequestException('return_reason_required');
    }

    this.assertDependenciesReady(task);
    this.assertFilesAvailable(task);
    task.status = 'WORKING';
    task.blockingReason = reason.trim();
    task.updatedAt = new Date();
    this.acquireFileOwnership(task);

    return this.cloneTask(task);
  }

  markReadyForReview(id: string): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['VERIFYING']);
    if (!task.evidence) {
      throw new BadRequestException('verification_evidence_required');
    }

    task.status = 'READY_FOR_REVIEW';
    task.updatedAt = new Date();
    this.releaseFileOwnership(task.id);

    return this.cloneTask(task);
  }

  approveTask(id: string, explicitUserApproval: boolean): SupervisorTask {
    const task = this.requireTask(id);
    this.requireStatus(task, ['READY_FOR_REVIEW']);
    if (!explicitUserApproval) {
      throw new BadRequestException('explicit_user_approval_required');
    }

    task.status = 'APPROVED';
    task.updatedAt = new Date();
    return this.cloneTask(task);
  }

  checkPermission(
    role: SupervisorAgentRole,
    action: SupervisorAction,
    context: PermissionContext = {},
  ): PermissionDecision {
    if (PROTECTED_INTEGRATION_ACTIONS.has(action)) {
      if (role !== 'supervisor') {
        return { allowed: false, reason: 'worker_protected_action_denied' };
      }
      if (!context.explicitUserAuthorization) {
        return {
          allowed: false,
          reason: 'explicit_user_authorization_required',
        };
      }
      return { allowed: true, reason: null };
    }

    if (action === 'deploy_production') {
      if (role !== 'supervisor' && role !== 'infra') {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      return context.explicitUserAuthorization
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_user_authorization_required' };
    }

    if (action === 'deploy_non_production') {
      if (role !== 'supervisor' && role !== 'infra') {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      return context.supervisorAuthorization
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'supervisor_authorization_required' };
    }

    if (BASE_ALLOWED_ACTIONS.has(action)) {
      if (role === 'qa' && action === 'edit_assigned_files') {
        return context.taskScopeIncludesAction
          ? { allowed: true, reason: null }
          : { allowed: false, reason: 'test_or_fixture_scope_required' };
      }
      return { allowed: true, reason: null };
    }

    if (action === 'change_database_schema' || action === 'run_migration') {
      if (role !== 'database' && role !== 'supervisor') {
        return { allowed: false, reason: 'database_role_required' };
      }
      return context.taskScopeIncludesAction
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_task_scope_required' };
    }

    if (action === 'change_runtime_config') {
      if (role !== 'infra' && role !== 'supervisor') {
        return { allowed: false, reason: 'infra_role_required' };
      }
      return context.taskScopeIncludesAction
        ? { allowed: true, reason: null }
        : { allowed: false, reason: 'explicit_task_scope_required' };
    }

    if (action === 'change_auth_or_identity') {
      if (!['frontend', 'backend', 'supervisor'].includes(role)) {
        return { allowed: false, reason: 'role_not_allowed' };
      }
      if (!context.taskScopeIncludesAction) {
        return { allowed: false, reason: 'explicit_task_scope_required' };
      }
      if (role !== 'supervisor' && !context.supervisorAuthorization) {
        return { allowed: false, reason: 'supervisor_authorization_required' };
      }
      return { allowed: true, reason: null };
    }

    return { allowed: false, reason: 'default_deny' };
  }

  private assertDependenciesReady(task: SupervisorTask) {
    const unresolved = task.dependsOn.filter((dependencyId) => {
      const dependency = this.tasks.get(dependencyId);
      return (
        !dependency ||
        !(['READY_FOR_REVIEW', 'APPROVED'] as SupervisorTaskStatus[]).includes(
          dependency.status,
        )
      );
    });

    if (unresolved.length > 0) {
      throw new BadRequestException({
        code: 'dependencies_not_ready',
        unresolved,
      });
    }
  }

  private assertFilesAvailable(task: SupervisorTask) {
    const conflicts = task.allowedPaths
      .map((path) => ({ path, owner: this.fileOwners.get(path) }))
      .filter(
        (entry): entry is { path: string; owner: string } =>
          Boolean(entry.owner && entry.owner !== task.id),
      );

    if (conflicts.length > 0) {
      throw new ConflictException({
        code: 'file_ownership_conflict',
        conflicts,
      });
    }
  }

  private acquireFileOwnership(task: SupervisorTask) {
    for (const path of task.allowedPaths) {
      this.fileOwners.set(path, task.id);
    }
  }

  private releaseFileOwnership(taskId: string) {
    for (const [path, owner] of this.fileOwners.entries()) {
      if (owner === taskId) {
        this.fileOwners.delete(path);
      }
    }
  }

  private validateCreateInput(input: CreateSupervisorTaskInput) {
    if (!input.objective?.trim()) {
      throw new BadRequestException('objective_required');
    }
    if (!input.owner || input.owner === ('supervisor' as never)) {
      throw new BadRequestException('worker_owner_required');
    }
    if (!Array.isArray(input.allowedPaths) || input.allowedPaths.length === 0) {
      throw new BadRequestException('allowed_paths_required');
    }
    if (!Array.isArray(input.acceptance) || input.acceptance.length === 0) {
      throw new BadRequestException('acceptance_required');
    }
  }

  private validateEvidence(task: SupervisorTask, evidence: SupervisorEvidence) {
    if (!evidence.rootCause?.trim()) {
      throw new BadRequestException('root_cause_required');
    }
    if (!evidence.deploymentState?.trim()) {
      throw new BadRequestException('deployment_state_required');
    }
    if (!evidence.gitState?.trim()) {
      throw new BadRequestException('git_state_required');
    }

    const outsideScope = evidence.changedFiles.filter(
      (path) => !task.allowedPaths.includes(path),
    );
    if (outsideScope.length > 0) {
      throw new BadRequestException({
        code: 'changed_files_outside_scope',
        paths: outsideScope,
      });
    }
  }

  private requireStatus(task: SupervisorTask, allowed: SupervisorTaskStatus[]) {
    if (!allowed.includes(task.status)) {
      throw new BadRequestException({
        code: 'invalid_transition',
        current: task.status,
        allowedFrom: allowed,
      });
    }
  }

  private requireTask(id: string): SupervisorTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`supervisor_task_not_found:${id}`);
    }
    return task;
  }

  private nextTaskId(now: Date) {
    this.sequence += 1;
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    return `ATLAS-${date}-${String(this.sequence).padStart(4, '0')}`;
  }

  private unique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
  }

  private cloneTask(task: SupervisorTask): SupervisorTask {
    return {
      ...task,
      allowedPaths: [...task.allowedPaths],
      forbiddenActions: [...task.forbiddenActions],
      dependsOn: [...task.dependsOn],
      acceptance: [...task.acceptance],
      evidence: task.evidence
        ? {
            ...task.evidence,
            changedFiles: [...task.evidence.changedFiles],
            tests: [...task.evidence.tests],
            regression: [...task.evidence.regression],
            remainingRisk: [...task.evidence.remainingRisk],
          }
        : null,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
    };
  }
}
