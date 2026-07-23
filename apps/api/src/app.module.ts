import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssetImageModule } from './asset-image/asset-image.module';
import { AssetsModule } from './assets/assets.module';
import { BrandsModule } from './brands/brands.module';
import { CampaignPlannerModule } from './campaign-planner/campaign-planner.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CopilotModule } from './copilot/copilot.module';
import { DatabaseModule } from './database/database.module';
import { HistoryModule } from './history/history.module';
import { ImageModule } from './image/image.module';
import { RewriteModule } from './rewrite/rewrite.module';
import { VersionsModule } from './versions/versions.module';

import { PromptChainModule } from './prompt-chain/prompt-chain.module';
@Module({
  imports: [
    PromptChainModule,
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    BrandsModule,
    CampaignsModule,
    CampaignPlannerModule,
    HistoryModule,
    AssetsModule,
    AssetImageModule,
    CopilotModule,
    RewriteModule,
    VersionsModule,
    AiModule,
    ImageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
