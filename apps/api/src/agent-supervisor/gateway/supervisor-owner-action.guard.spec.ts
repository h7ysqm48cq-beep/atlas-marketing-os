import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SupervisorOwnerActionGuard } from './supervisor-owner-action.guard';
import { SupervisorOwnerGuard } from './supervisor-owner.guard';

const OWNER_ID = 'authenticated-owner-id';
const OWNER_TOKEN = 'server-owned-secret';

describe('SupervisorOwnerActionGuard', () => {
  function request(
    method: string,
    options: {
      userId?: string;
      marker?: string;
      suppliedToken?: string;
    } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.marker) {
      headers['x-atlas-supervisor-owner-action'] = options.marker;
    }
    if (options.suppliedToken) {
      headers['x-atlas-supervisor-owner-token'] = options.suppliedToken;
    }

    return {
      method,
      headers,
      ...(options.userId ? { user: { id: options.userId } } : {}),
    };
  }

  function context(value: ReturnType<typeof request>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => value }),
    } as unknown as ExecutionContext;
  }

  function config(values: Record<string, string | undefined>) {
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  function guard(values: Record<string, string | undefined>) {
    return new SupervisorOwnerActionGuard(config(values));
  }

  it('leaves read-only requests unchanged', () => {
    const value = request('GET', { suppliedToken: 'caller-token' });

    expect(guard({}).canActivate(context(value))).toBe(true);
    expect(value.headers['x-atlas-supervisor-owner-token']).toBe(
      'caller-token',
    );
  });

  it('rejects an unauthenticated mutation', () => {
    expect(() =>
      guard({
        ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
        ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
      }).canActivate(context(request('POST', { marker: '1' }))),
    ).toThrow(UnauthorizedException);
  });

  it('fails closed when owner identity or credential configuration is missing', () => {
    const value = context(request('POST', { userId: OWNER_ID, marker: '1' }));

    expect(() =>
      guard({ ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN }).canActivate(value),
    ).toThrow('supervisor_owner_identity_not_configured');
    expect(() =>
      guard({ ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID }).canActivate(value),
    ).toThrow('supervisor_owner_credential_not_configured');
  });

  it('rejects an authenticated non-owner', () => {
    expect(() =>
      guard({
        ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
        ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
      }).canActivate(
        context(
          request('POST', {
            userId: 'different-user-id',
            marker: '1',
          }),
        ),
      ),
    ).toThrow('supervisor_authenticated_owner_required');
  });

  it('requires an explicit owner action marker', () => {
    expect(() =>
      guard({
        ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
        ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
      }).canActivate(context(request('POST', { userId: OWNER_ID }))),
    ).toThrow('supervisor_owner_action_required');
  });

  it('rejects an owner action marker other than the exact value', () => {
    expect(() =>
      guard({
        ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
        ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
      }).canActivate(
        context(request('POST', { userId: OWNER_ID, marker: 'true' })),
      ),
    ).toThrow('supervisor_owner_action_required');
  });

  it('supplies only the server-owned credential to the existing guard', () => {
    const value = request('POST', {
      userId: OWNER_ID,
      marker: '1',
      suppliedToken: 'caller-controlled-token',
    });
    const requestContext = context(value);
    const configured = config({
      ATLAS_SUPERVISOR_OWNER_USER_ID: OWNER_ID,
      ATLAS_SUPERVISOR_OWNER_TOKEN: OWNER_TOKEN,
    });

    expect(
      new SupervisorOwnerActionGuard(configured).canActivate(requestContext),
    ).toBe(true);
    expect(value.headers['x-atlas-supervisor-owner-token']).toBe(OWNER_TOKEN);
    expect(
      new SupervisorOwnerGuard(configured).canActivate(requestContext),
    ).toBe(true);
  });
});
