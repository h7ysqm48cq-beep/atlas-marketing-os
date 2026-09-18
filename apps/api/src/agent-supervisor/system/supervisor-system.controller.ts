import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import {
  SupervisorSystemGuard,
  SupervisorSystemPurposeRequired,
  type SupervisorSystemAdmissionRequest,
} from './supervisor-system.guard';
import {
  SupervisorSystemAdmissionService,
} from './supervisor-system-admission.service';

@Public()
@UseGuards(SupervisorSystemGuard)
@Controller('engineering/supervisor/system')
export class SupervisorSystemController {
  constructor(
    private readonly admissions:
      SupervisorSystemAdmissionService,
  ) {}

  @Post('admissions')
  @SupervisorSystemPurposeRequired('ADMISSION')
  admit(
    @Body() input: SupervisorSystemAdmissionRequest,
  ) {
    return this.admissions.admit(input);
  }
}
