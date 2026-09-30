import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AgentSupervisorService } from '../agent-supervisor.service';
import { WorkerDispatcherService } from '../dispatch/worker-dispatcher.service';
import type {
  SupervisorExecution,
} from '../execution/supervisor-execution.types';
import type {
  SupervisorSystemAdmissionRequest,
} from './supervisor-system.guard';

const ADMISSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SupervisorSystemAdmissionResult {
  admissionId: string;
  taskId: string;
  taskStatus: string;
  executionId: string;
  executionStatus: string;
}

@Injectable()
export class SupervisorSystemAdmissionService {
  constructor(
    private readonly supervisor: AgentSupervisorService,
    private readonly dispatcher: WorkerDispatcherService,
  ) {}

  async admit(
    input: SupervisorSystemAdmissionRequest,
  ): Promise<SupervisorSystemAdmissionResult> {
    const admissionId =
      input.admissionId?.trim().toLowerCase() ?? '';
    if (!ADMISSION_ID.test(admissionId)) {
      throw new BadRequestException(
        'supervisor_system_admission_id_invalid',
      );
    }

    const taskId = `ATLAS-SYS-${admissionId}`;
    let task = await this.supervisor.createSystemTask(
      taskId,
      input.task,
    );

    if (task.status === 'DRAFT') {
      task = await this.supervisor.startTask(taskId);
    }

    const executions =
      await this.dispatcher.listByTask(taskId);

    if (executions.length > 1) {
      throw new ConflictException({
        code: 'supervisor_system_admission_execution_cardinality_violation',
        taskId,
        executionIds: executions.map(
          (execution) => execution.id,
        ),
      });
    }

    let execution: SupervisorExecution | undefined =
      executions[0];

    if (!execution) {
      if (task.status !== 'WORKING') {
        throw new ConflictException({
          code: 'supervisor_system_admission_task_not_dispatchable',
          taskId,
          status: task.status,
        });
      }

      execution = (
        await this.dispatcher.dispatch(
          taskId,
          'IMPLEMENTATION',
          input.frozenBaseSha
            ? {
                frozenBaseSha:
                  input.frozenBaseSha,
              }
            : {},
        )
      ).execution;
    }

    return {
      admissionId,
      taskId,
      taskStatus: task.status,
      executionId: execution.id,
      executionStatus: execution.status,
    };
  }
}
