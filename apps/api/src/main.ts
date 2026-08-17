import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin(origin, callback) {
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3002',
        process.env.WEB_URL,
      ].filter((value): value is string => Boolean(value));
      const isPrivateNetworkDevOrigin =
        process.env.NODE_ENV !== 'production' &&
        Boolean(
          origin &&
            /^https?:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)[^/]+(?::\d+)?$/.test(
              origin,
            ),
        );

      callback(
        null,
        !origin || allowedOrigins.includes(origin) || isPrivateNetworkDevOrigin,
      );
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  });

  app.useStaticAssets(join(process.cwd(), 'storage'), {
    prefix: '/storage/',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT) || 3001;

  await app.listen(port, '0.0.0.0');

  console.log(`Atlas API running on port ${port}`);
}

void bootstrap();
