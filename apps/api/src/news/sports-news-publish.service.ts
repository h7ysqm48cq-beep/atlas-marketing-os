import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ScheduledPostStatus, SocialPlatform } from '../generated/prisma/enums';

@Injectable()
export class SportsNewsPublishService {
  constructor(private readonly prisma: PrismaService) {}

  async queue(input:{ kind:'morning'|'evening'; content:string; mediaUrls:string[]; timezone:string; autoPublishEnabled:boolean; approvalRequired:boolean; telegram:boolean; telegramChannelId:string|null; facebook:boolean; facebookChannelId:string|null }) {
    const channelIds = [input.telegram ? input.telegramChannelId : null, input.facebook ? input.facebookChannelId : null].filter((id):id is string=>Boolean(id));
    const channels = await this.prisma.socialChannel.findMany({ where:{ id:{ in:channelIds } }, include:{ brand:true } });
    const byId = new Map(channels.map(c=>[c.id,c]));
    const status = input.approvalRequired || !input.autoPublishEnabled ? ScheduledPostStatus.DRAFT : ScheduledPostStatus.QUEUED;
    const now = new Date();
    const created = [];
    const add = async(channelId:string|null, platform:SocialPlatform) => {
      if (!channelId) return;
      const channel = byId.get(channelId);
      if (!channel) throw new Error(`${platform} channel not found.`);
      if (channel.platform !== platform) throw new Error(`Selected channel is not ${platform}.`);
      created.push(await this.prisma.scheduledPost.create({ data:{ brandId:channel.brandId, channelId:channel.id, platform, title:`MGM Sports ${input.kind === 'morning' ? 'Morning' : 'Evening'} Report`, content:input.content, mediaUrls:input.mediaUrls, scheduledAt:now, timezone:input.timezone, status } }));
    };
    if (input.telegram) await add(input.telegramChannelId, SocialPlatform.TELEGRAM);
    if (input.facebook) await add(input.facebookChannelId, SocialPlatform.FACEBOOK);
    return { posts:created, status, queued:status===ScheduledPostStatus.QUEUED };
  }
}
