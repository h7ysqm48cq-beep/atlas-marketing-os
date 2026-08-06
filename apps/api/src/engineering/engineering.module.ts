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

@Module({
  controllers: [
    EngineeringController,
    ApplyController,
    ChangeHistoryController,
    GitController,
    GitCommitController,
  ],
  providers: [
    EngineeringService,
    ApplyService,
    ChangeHistoryService,
    GitService,
    GitCommitService,
  ],
  exports: [
    EngineeringService,
    ApplyService,
  ],
})
export class EngineeringModule {}
