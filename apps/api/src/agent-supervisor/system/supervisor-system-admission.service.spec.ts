import { ConflictException } from '@nestjs/common';
import type { AgentSupervisorService } from '../agent-supervisor.service';
import type { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import type {
  SupervisorExecution,
} from '../execution/supervisor-execution.types';
import {
  SupervisorSystemAdmissionService,
} from './supervisor-system-admission.service';
import type {
  SupervisorSystemAdmissionRequest,
} from './supervisor-system.guard';

const INPUT: SupervisorSystemAdmissionRequest = {
  admissionId: '11111111-2222-3333-4444-555555555555',
  task: {
    objective: 'System admission',
    owner: 'engineering',
    allowedPaths: ['apps/api/src/example.ts'],
    forbiddenActions: ['merge', 'deploy_production'],
    dependsOn: [],
    acceptance: ['passes'],
  },
  frozenBaseSha: 'a'.repeat(40),
};

describe('SupervisorSystemAdmissionService', () => {
  it('creates, starts and dispatches once, then reuses the same execution', async () => {
    let taskStatus = 'DRAFT';
    const executions: SupervisorExecution[] = [];

    const supervisor = {
      createSystemTask: jest.fn(async (taskId: string) => ({
        id: taskId,
        ...INPUT.task,
        status: taskStatus,
        evidence: null,
        blockingReason: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      startTask: jest.fn(async (taskId: string) => {
        taskStatus = 'WORKING';
        return {
          id: taskId,
          ...INPUT.task,
          status: taskStatus,
          evidence: null,
          blockingReason: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    } as unknown as AgentSupervisorService;

    const dispatcher = {
      listByTask: jest.fn(async () => [...executions]),
      dispatch: jest.fn(async (taskId: string) => {
        const execution = {
          id: 'ATLAS-EXEC-SYSTEM-1',
          taskId,
          workerRole: 'engineering',
          status: 'QUEUED',
          assignment: {} as never,
          result: null,
          error: null,
          createdAt: new Date(),
          startedAt: null,
          completedAt: null,
          runnerId: null,
          claimEpoch: 0,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
        } as SupervisorExecution;
        executions.push(execution);
        return {
          execution,
          assignment: execution.assignment,
        };
      }),
    } as unknown as WorkerDispatcherService;

    const service =
      new SupervisorSystemAdmissionService(
        supervisor,
        dispatcher,
      );

    const first = await service.admit(INPUT);
    const second = await service.admit(INPUT);

    expect(first).toMatchObject({
      taskId:
        'ATLAS-SYS-11111111-2222-3333-4444-555555555555',
      taskStatus: 'WORKING',
      executionId: 'ATLAS-EXEC-SYSTEM-1',
      executionStatus: 'QUEUED',
    });
    expect(second.executionId).toBe(first.executionId);
    expect(supervisor.startTask).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      first.taskId,
      'IMPLEMENTATION',
      { frozenBaseSha: 'a'.repeat(40) },
    );
  });

  it('fails closed if one admission already has multiple executions', async () => {
    const supervisor = {
      createSystemTask: jest.fn(async (taskId: string) => ({
        id: taskId,
        ...INPUT.task,
        status: 'WORKING',
        evidence: null,
        blockingReason: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    } as unknown as AgentSupervisorService;

    const execution = (id: string) =>
      ({
        id,
        taskId:
          'ATLAS-SYS-11111111-2222-3333-4444-555555555555',
        workerRole: 'engineering',
        status: 'FAILED',
        assignment: {} as never,
        result: null,
        error: 'test',
        createdAt: new Date(),
        startedAt: null,
        completedAt: new Date(),
        runnerId: null,
        claimEpoch: 0,
        lastHeartbeatAt: null,
        leaseExpiresAt: null,
      }) as SupervisorExecution;

    const dispatcher = {
      listByTask: jest.fn(async () => [
        execution('EXEC-1'),
        execution('EXEC-2'),
      ]),
    } as unknown as WorkerDispatcherService;

    const service =
      new SupervisorSystemAdmissionService(
        supervisor,
        dispatcher,
      );

    await expect(service.admit(INPUT)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
