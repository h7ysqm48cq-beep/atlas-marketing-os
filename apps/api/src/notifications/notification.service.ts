import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { PrismaService } from '../database/prisma.service';

type PushInput = {
  title: string;
  body: string;
  tag: string;
  url?: string | null;
  category?: 'published' | 'failed' | 'system';
};

type SubscriptionInput = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

type StoredSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private readonly publicKey: string | null;
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject = config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:admin@atlas.local';
    this.publicKey = publicKey || null;
    this.enabled = Boolean(publicKey && privateKey);

    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    }
  }

  async onModuleInit() {
    // PushSubscription schema is managed exclusively by Prisma migrations.
  }

  getConfig() {
    return { enabled: this.enabled, publicKey: this.publicKey };
  }

  async subscribe(input: SubscriptionInput, userAgent?: string) {
    const endpoint = input.endpoint?.trim();
    const p256dh = input.keys?.p256dh?.trim();
    const auth = input.keys?.auth?.trim();
    if (!endpoint?.startsWith('https://') || !p256dh || !auth) {
      throw new BadRequestException('A valid push subscription is required.');
    }

    const id = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "PushSubscription" ("id", "endpoint", "p256dh", "auth", "userAgent", "enabled", "updatedAt")
      VALUES (${id}, ${endpoint}, ${p256dh}, ${auth}, ${userAgent?.slice(0, 500) || null}, TRUE, NOW())
      ON CONFLICT ("endpoint") DO UPDATE SET
        "p256dh" = EXCLUDED."p256dh",
        "auth" = EXCLUDED."auth",
        "userAgent" = EXCLUDED."userAgent",
        "enabled" = TRUE,
        "updatedAt" = NOW()
    `;
    return { subscribed: true };
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.$executeRaw`
      UPDATE "PushSubscription" SET "enabled" = FALSE, "updatedAt" = NOW()
      WHERE "endpoint" = ${endpoint?.trim() || ''}
    `;
    return { unsubscribed: true };
  }

  async notify(input: PushInput) {
    if (!this.enabled) {
      this.logger.warn('Push notification skipped: VAPID keys are not configured.');
      return { sent: 0, skipped: true };
    }

    const subscriptions = await this.prisma.$queryRaw<StoredSubscription[]>`
      SELECT "endpoint", "p256dh", "auth"
      FROM "PushSubscription"
      WHERE "enabled" = TRUE
    `;
    const payload = JSON.stringify({
      title: input.title,
      body: input.body,
      tag: input.tag,
      url: input.url || '/calendar',
      category: input.category || 'system',
    });
    let sent = 0;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          payload,
        );
        sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await this.unsubscribe(subscription.endpoint);
        } else {
          this.logger.warn(`Push notification failed for one subscription: ${statusCode || 'unknown'}`);
        }
      }
    }
    return { sent, skipped: false };
  }
}
