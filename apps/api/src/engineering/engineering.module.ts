import {
  Module,
} from '@nestjs/common';

import {
  EngineeringController,
} from './engineering.controller';
import {
  EngineeringService,
} from './engineering.service';

import {
  PatchController,
} from './patch/patch.controller';

import {
  PatchService,
} from './patch/patch.service';



import {
  PatchValidator,
} from './patch/patch.validator';

import {
  ApplyController,
} from './apply/apply.controller';

import {
  ApplyService,
} from './apply/apply.service';

import {
  ChangeHistoryController,
} from './history/change-history.controller';

import {
  ChangeHistoryService,
} from './history/change-history.service';

import {
  GitController,
} from './git/git.controller';

import {
  GitService,
} from './git/git.service';

import {
  GitCommitService,
} from './git/git.commit.service';

import {
  GitCommitController,
} from './git/git.commit.controller';

import {
  RollbackController,
} from './rollback/rollback.controller';

import {
  RollbackService,
} from './rollback/rollback.service';

import {
  SnapshotController,
} from './snapshot/snapshot.controller';

import {
  SnapshotService,
} from './snapshot/snapshot.service';

import {
RepositoryController,
} from './repository/repository.controller';

import {
RepositoryService,
} from './repository/repository.service';

import {
RepositoryScanner,
} from './repository/repository.scanner';

import {
RepositoryContextService,
} from './repository/repository.context.service';


import {
RecoveryController,
} from './recovery/recovery.controller';

import {
RecoveryService,
} from './recovery/recovery.service';


import {
RecoveryModule,
} from './recovery/recovery.module';


import {
ValidationController,
} from './validation/validation.controller';

import {
ValidationService,
} from './validation/validation.service';

@Module({
  imports: [
    RecoveryModule,
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
    PatchService,
    ApplyService,
    ValidationService,
    RepositoryContextService,
  ],
})
export class EngineeringModule {}
