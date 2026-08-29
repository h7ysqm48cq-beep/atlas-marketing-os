import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ListJobsDto } from './dto/list-jobs.dto';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  findAll(@Query() query: ListJobsDto) {
    return this.jobsService.findAll(query);
  }

  @Get('stats')
  getStats() {
    return this.jobsService.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.jobsService.retry(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.jobsService.cancel(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobsService.remove(id);
  }
}
