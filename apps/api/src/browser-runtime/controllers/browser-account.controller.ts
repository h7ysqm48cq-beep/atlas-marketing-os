import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  SocialPlatform,
  SocialProxyType,
} from '../../generated/prisma/client';
import {
  BrowserAccountService,
} from '../services/browser-account.service';

type CreateBrowserAccountBody = {
  displayName: string;
  platform?: SocialPlatform;
  browserProfileName?: string;
  locale?: string;
  timezone?: string;

  proxyType?: SocialProxyType;
  proxyHost?: string | null;
  proxyPort?: number | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  proxyCountry?: string | null;

  workspaceId?: string | null;
  brandId?: string | null;
};

@Controller('browser-runtime/accounts')
export class BrowserAccountController {
  constructor(
    private readonly browserAccounts:
      BrowserAccountService,
  ) {}

  @Get()
  list() {
    return this.browserAccounts.list();
  }

  @Get(':id')
  getById(
    @Param('id')
    id: string,
  ) {
    return this.browserAccounts.getById(
      id,
    );
  }

  @Post()
  create(
    @Body()
    body: CreateBrowserAccountBody,
  ) {
    return this.browserAccounts.create(
      body,
    );
  }
}
