import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { AuthContextService } from './auth-context.service';

type RequestWithUser = {
  user?: { id?: string };
};

@Injectable()
export class AuthContextInterceptor implements NestInterceptor {
  constructor(private readonly authContext: AuthContextService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): any {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return this.authContext.run(request.user?.id ?? null, () => next.handle());
  }
}
