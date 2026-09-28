import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '@cbt/shared';

const AUDITED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (!AUDITED_METHODS.includes(method)) {
      return next.handle();
    }

    const user = request.user as JwtPayload | undefined;
    const action = `${method} ${request.route?.path || request.url}`;

    return next.handle().pipe(
      tap(async (responseData) => {
        if (!user?.tenantId) return;

        try {
          await this.prisma.auditLog.create({
            data: {
              tenantId: user.tenantId,
              userId: user.sub,
              action,
              resourceType: request.route?.path?.split('/')[1] || 'unknown',
              ipAddress: request.ip,
              userAgent: request.headers['user-agent'],
              newValue: responseData ? JSON.parse(JSON.stringify(responseData)) : undefined,
            },
          });
        } catch {
          // Audit logging should not break the request
        }
      }),
    );
  }
}
