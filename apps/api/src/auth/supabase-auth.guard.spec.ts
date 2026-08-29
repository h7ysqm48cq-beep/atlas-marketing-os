import {
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Public } from './public.decorator';
import { SupabaseAuthGuard } from './supabase-auth.guard';

function contextFor(
  authorization?: string,
  publicRoute = false,
) {
  const handler = () => undefined;
  if (publicRoute) {
    Public()(handler);
  }

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization },
      }),
    }),
  } as unknown as ExecutionContext;
}

function config() {
  return {
    get: jest.fn(),
  } as unknown as ConfigService;
}

describe('SupabaseAuthGuard', () => {
  it('rejects protected requests without a bearer token', async () => {
    const guard = new SupabaseAuthGuard(config(), new Reflector());

    await expect(
      guard.canActivate(contextFor()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows explicitly public routes without authentication', async () => {
    const guard = new SupabaseAuthGuard(config(), new Reflector());

    await expect(
      guard.canActivate(contextFor(undefined, true)),
    ).resolves.toBe(true);
  });
});
