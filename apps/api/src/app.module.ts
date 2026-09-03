import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.validation';
import { StorageModule } from './common/storage/storage.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { QuestionsModule } from './modules/questions/questions.module';
import { ExamsModule } from './modules/exams/exams.module';
import { ExamEngineModule } from './modules/exam-engine/exam-engine.module';
import { ProctoringModule } from './modules/proctoring/proctoring.module';
import { ResultsModule } from './modules/results/results.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AiModule } from './modules/ai/ai.module';
import { CurriculumModule } from './modules/curriculum/curriculum.module';
import { BatchesModule } from './modules/batches/batches.module';
import { MaterialsModule } from './modules/materials/materials.module';
import { LearningModule } from './modules/learning/learning.module';
import { RagModule } from './modules/rag/rag.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // apps/api/.env wins over monorepo root so API secrets (e.g. OPENAI_API_KEY) are not blanked
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    StorageModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [
          { name: 'default', ttl: 60000, limit: 100 },
          { name: 'auth', ttl: 60000, limit: 10 },
        ],
        storage,
      }),
    }),
    PrismaModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    CandidatesModule,
    QuestionsModule,
    ExamsModule,
    ExamEngineModule,
    ProctoringModule,
    ResultsModule,
    AuditModule,
    HealthModule,
    AnalyticsModule,
    AiModule,
    CurriculumModule,
    BatchesModule,
    MaterialsModule,
    LearningModule,
    RagModule,
    OnboardingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, TenantMiddleware)
      .forRoutes('*');
  }
}
