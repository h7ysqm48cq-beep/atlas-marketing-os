import { Body, Controller, Delete, Headers, Post, Get } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Public } from '../auth/public.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('vapid-public-key')
  @Public()
  getVapidPublicKey() {
    return this.notifications.getConfig();
  }

  @Post('subscriptions')
  subscribe(
    @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } },
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.notifications.subscribe(body, userAgent);
  }

  @Delete('subscriptions')
  unsubscribe(@Body() body: { endpoint?: string }) {
    return this.notifications.unsubscribe(body.endpoint || '');
  }
}
