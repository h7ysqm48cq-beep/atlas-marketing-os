import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

type AuthenticatedRequest = Request & {
  user?: {
    id: string;
    claims: Record<string, unknown>;
  };
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly supabaseUrl: string | null;
  private readonly jwksUrl: URL | null;
  private jwksPromise:
    Promise<
      ReturnType<
        typeof import('jose')['createRemoteJWKSet']
      >
    > | null = null;

  constructor(
    configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const configuredUrl =
      configService.get<string>('SUPABASE_URL')?.trim() ||
      configService.get<string>('NEXT_PUBLIC_SUPABASE_URL')?.trim() ||
      null;

    this.supabaseUrl = configuredUrl?.replace(/\/+$/, '') || null;
    this.jwksUrl = this.supabaseUrl
      ? new URL(`${this.supabaseUrl}/auth/v1/.well-known/jwks.json`)
      : null;
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token || !this.jwksUrl || !this.supabaseUrl) {
      throw new UnauthorizedException('Authentication is required.');
    }

    try {
      const { jwtVerify } = await import('jose');
      const jwks = await this.getJwks();
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${this.supabaseUrl}/auth/v1`,
        audience: 'authenticated',
      });

      if (!payload.sub) {
        throw new Error('Authenticated token has no subject.');
      }

      request.user = {
        id: payload.sub,
        claims: payload,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid authentication token.');
    }
  }

  private getJwks() {
    if (!this.jwksPromise) {
      this.jwksPromise = import('jose').then(({ createRemoteJWKSet }) =>
        createRemoteJWKSet(this.jwksUrl!),
      );
    }

    return this.jwksPromise;
  }

  private extractBearerToken(authorization?: string) {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
  }
}
