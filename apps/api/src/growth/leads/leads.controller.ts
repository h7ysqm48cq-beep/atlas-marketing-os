import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LeadStatus } from '../../generated/prisma/client';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

@Controller('growth/leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadsService.create(dto);
  }

  @Get()
  findAll(
    @Query('status') status?: LeadStatus,
    @Query('search') search?: string,
  ) {
    return this.leadsService.findAll(status, search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }

  @Post(':id/activities')
  addActivity(@Param('id') id: string, @Body() dto: CreateLeadActivityDto) {
    return this.leadsService.addActivity(id, dto);
  }

  @Get(':id/activities')
  getActivities(@Param('id') id: string) {
    return this.leadsService.getActivities(id);
  }
}
