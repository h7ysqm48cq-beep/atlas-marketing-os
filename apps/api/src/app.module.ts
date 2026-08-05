import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssetImageModule } from './asset-image/asset-image.module';
import { AssetsModule } from './assets/assets.module';
import { BrandsModule } from './brands/brands.module';
import { CampaignPlannerModule } from './campaign-planner/campaign-planner.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CampaignStrategyModule } from './campaign-strategy/campaign-strategy.module';
import { CopilotModule } from './copilot/copilot.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { HistoryModule } from './history/history.module';
import { ImageModule } from './image/image.module';
import { MemoryModule } from './memory/memory.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { RewriteModule } from './rewrite/rewrite.module';
import { VersionsModule } from './versions/versions.module';
import { AiUsageModule } from './ai-usage/ai-usage.module';
import { AutomationModule } from './automation/automation.module';
import { WorkflowModule } from './workflow/workflow.module';

import { PromptChainModule } from './prompt-chain/prompt-chain.module';
import { ScheduleModule } from '@nestjs/schedule';
import { StrategyModule } from './strategy/strategy.module';
import { PromptsModule } from './prompts/prompts.module';
import { PlannerModule } from './planner/planner.module';
import { PromptBuilderModule } from './prompt-builder/prompt-builder.module';
import { AiProviderModule } from './ai-provider/ai-provider.module';
import { ContentEngineModule } from './content-engine/content-engine.module';
import { ContentValidatorModule } from './content-validator/content-validator.module';
import { ImagePromptEngineModule } from './image-prompt-engine/image-prompt-engine.module';
import { AgentWorkflowModule } from './agent-workflow/agent-workflow.module';
import { BrowserRuntimeModule } from './browser-runtime/browser-runtime.module';
import { JobsModule } from './jobs/jobs.module';
@Module({
  imports: [
    JobsModule,
    BrowserRuntimeModule,
    PlannerModule,
    PromptBuilderModule,
    AiProviderModule,
    ContentEngineModule,
    ContentValidatorModule,
    ImagePromptEngineModule,
    AgentWorkflowModule,
    DashboardModule,
    StrategyModule,
    PromptsModule,
    ScheduleModule.forRoot(), AutomationModule, WorkflowModule, AiUsageModule, 
    PromptChainModule,
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CommonModule,
    BrandsModule,
    CampaignsModule,
    CampaignPlannerModule,
    CampaignStrategyModule,
    HistoryModule,
    MemoryModule,
    KnowledgeModule,
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
