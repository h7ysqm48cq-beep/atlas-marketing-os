import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BrandsModule } from './brands/brands.module';
import { DatabaseModule } from './database/database.module';
import { ImageModule } from './image/image.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    BrandsModule,
    AiModule,
    ImageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
