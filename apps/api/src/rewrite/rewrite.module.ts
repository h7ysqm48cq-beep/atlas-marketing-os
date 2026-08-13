import { Module } from '@nestjs/common';
import { AiRuntimeModule } from '../ai-runtime/ai-runtime.module';
import { BrandsModule } from '../brands/brands.module';
import { RewriteController } from './rewrite.controller';
import { RewriteService } from './rewrite.service';

@Module({
  imports: [BrandsModule, AiRuntimeModule],
  controllers: [RewriteController],
  providers: [RewriteService],
})
export class RewriteModule {}
