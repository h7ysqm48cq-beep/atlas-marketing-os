import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AuthContextService {
  private readonly storage = new AsyncLocalStorage<string | null>();

  run<T>(userId: string | null, callback: () => T): T {
    return this.storage.run(userId, callback);
  }

  getUserId(): string | null {
    return this.storage.getStore() ?? null;
  }

  requireUserId(): string {
    const userId = this.getUserId();
    if (!userId) {
      throw new UnauthorizedException('Authentication is required.');
    }
    return userId;
  }
}
