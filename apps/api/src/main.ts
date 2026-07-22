import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3002'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT || 3001);
  await app.listen(port);

  console.log(`Atlas API running at http://localhost:${port}`);
}

void bootstrap();
