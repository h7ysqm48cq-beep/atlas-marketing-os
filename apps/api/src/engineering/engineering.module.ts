import { Module } from '@nestjs/common';
import { AgentSupervisorModule } from '../agent-supervisor/agent-supervisor.module';
import { EngineeringController } from './engineering.controller';
import { EngineeringService } from './engineering.service';
import { RepairModule } from './repair/repair.module';
import { PatchController } from './patch/patch.controller';
import { PatchProposalService } from './patch/patch-proposal.service';
import { PatchService } from './patch/patch.service';
import { PatchValidator } from './patch/patch.validator';
import { ApplyController } from './apply/apply.controller';
import { ApplyService } from './apply/apply.service';
import { ChangeHistoryController } from './history/change-history.controller';
import { ChangeHistoryService } from './history/change-history.service';
import { GitController } from './git/git.controller';
import { GitService } from './git/git.service';
import { GitCommitService } from './git/git.commit.service';
import { GitCommitController } from './git/git.commit.controller';
import { RollbackController } from './rollback/rollback.controller';
import { RollbackService } from './rollback/rollback.service';
import { SnapshotController } from './snapshot/snapshot.controller';
import { SnapshotService } from './snapshot/snapshot.service';
import { RepositoryController } from './repository/repository.controller';
import { RepositoryService } from './repository/repository.service';
import { AuditModule } from './audit/audit.module';
import { RepositoryScanner } from './repository/repository.scanner';
import { RepositoryContextService } from './repository/repository.context.service';
import { RecoveryModule } from './recovery/recovery.module';
import { ValidationController } from './validation/validation.controller';
import { ValidationService } from './validation/validation.service';
import { AstModule } from './ast/ast.module';

@Module({
  imports: [
    AgentSupervisorModule,
    RecoveryModule,
    RepairModule,
    AuditModule,
    AstModule,
  ],
  controllers: [
    EngineeringController,
    PatchController,
    ApplyController,
    ChangeHistoryController,
    GitController,
    GitCommitController,
    RollbackController,
    SnapshotController,
    RepositoryController,
    ValidationController,
  ],
  providers: [
    EngineeringService,
    PatchProposalService,
    PatchService,
    PatchValidator,
    ApplyService,
    ChangeHistoryService,
    GitService,
    GitCommitService,
    RollbackService,
    SnapshotService,
    RepositoryService,
    RepositoryScanner,
    RepositoryContextService,
    ValidationService,
  ],
  exports: [
    EngineeringService,
    PatchProposalService,
    PatchService,
    ApplyService,
    ValidationService,
    RepositoryContextService,
    AgentSupervisorModule,
  ],
})
export class EngineeringModule {}
