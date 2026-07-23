import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
} from '@nestjs/common';
import { UpdateFavoriteDto } from './dto/update-favorite.dto';
import { HistoryService } from './history.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list() {
    return this.historyService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.historyService.get(id);
  }

  @Patch(':id/favorite')
  updateFavorite(
    @Param('id') id: string,
    @Body() dto: UpdateFavoriteDto,
  ) {
    return this.historyService.updateFavorite(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.historyService.remove(id);
  }
}
