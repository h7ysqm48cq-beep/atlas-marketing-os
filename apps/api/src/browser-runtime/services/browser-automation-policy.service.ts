import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PrismaService,
} from '../../database/prisma.service';

type UpdatePolicyInput = {
  autoVerifyLogin?: boolean;
  autoDiscoverPages?: boolean;
  autoSyncPages?: boolean;
  autoHealthCheck?: boolean;
  autoCloseBrowser?: boolean;
  autoNotifications?: boolean;
  keepBrowserOpenAfterLogin?: boolean;
};

@Injectable()
export class BrowserAutomationPolicyService {
  constructor(
    private readonly prisma:
      PrismaService,
  ) {}

  async getOrCreate(
    accountId: string,
  ) {
    const account =
      await this.prisma
        .browserAccount
        .findUnique({
          where: {
            id: accountId,
          },
          select: {
            id: true,
          },
        });

    if (!account) {
      throw new NotFoundException(
        'Browser account was not found.',
      );
    }

    return this.prisma
      .browserAutomationPolicy
      .upsert({
        where: {
          browserAccountId:
            accountId,
        },
        create: {
          browserAccountId:
            accountId,
        },
        update: {},
      });
  }

  async update(
    accountId: string,
    input: UpdatePolicyInput,
  ) {
    await this.getOrCreate(
      accountId,
    );

    return this.prisma
      .browserAutomationPolicy
      .update({
        where: {
          browserAccountId:
            accountId,
        },
        data: {
          autoVerifyLogin:
            input.autoVerifyLogin,
          autoDiscoverPages:
            input.autoDiscoverPages,
          autoSyncPages:
            input.autoSyncPages,
          autoHealthCheck:
            input.autoHealthCheck,
          autoCloseBrowser:
            input.autoCloseBrowser,
          autoNotifications:
            input.autoNotifications,
          keepBrowserOpenAfterLogin:
            input.keepBrowserOpenAfterLogin,
        },
      });
  }
}
