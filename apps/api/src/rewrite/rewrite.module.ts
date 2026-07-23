import { Module } from '@nestjs/common';
import { BrandsModule } from '../brands/brands.module';
import { RewriteController } from './rewrite.controller';
import { RewriteService } from './rewrite.service';

@Module({
  imports: [BrandsModule],
  controllers: [RewriteController],
  providers: [RewriteService],
})
export class RewriteModule {}
