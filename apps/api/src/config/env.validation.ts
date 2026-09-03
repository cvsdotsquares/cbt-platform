import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidation');

const INSECURE_SECRETS = new Set([
  'change-me-access-secret-min-32-chars',
  'change-me-refresh-secret-min-32-chars',
  'test-access-secret-min-32-characters',
  'test-refresh-secret-min-32-characters',
  'build-access-secret-min-32-characters',
  'build-refresh-secret-min-32-characters',
]);

function requireString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function requireSecret(config: Record<string, unknown>, key: string, minLength = 32): string {
  const value = requireString(config, key);
  if (value.length < minLength) {
    throw new Error(`${key} must be at least ${minLength} characters`);
  }
  if (process.env.NODE_ENV === 'production' && INSECURE_SECRETS.has(value)) {
    throw new Error(`${key} must be changed from the default value in production`);
  }
  return value;
}

export function validateEnv(config: Record<string, unknown>) {
  requireString(config, 'DATABASE_URL');
  requireSecret(config, 'JWT_ACCESS_SECRET');
  requireSecret(config, 'JWT_REFRESH_SECRET');

  const redisUrl = config.REDIS_URL;
  if (process.env.NODE_ENV === 'production') {
    requireString(config, 'REDIS_URL');
  } else if (typeof redisUrl === 'string' && redisUrl.trim() === '') {
    // Redis is optional in development — throttling falls back to in-memory.
  }

  if (process.env.NODE_ENV === 'production') {
    const appUrl = requireString(config, 'APP_URL');
    if (!appUrl.startsWith('https://')) {
      logger.warn('APP_URL should use HTTPS in production');
    }

    const s3Bucket = config.AWS_S3_BUCKET;
    const hasS3 =
      typeof s3Bucket === 'string'
      && s3Bucket.length > 0
      && typeof config.AWS_ACCESS_KEY_ID === 'string'
      && config.AWS_ACCESS_KEY_ID.length > 0
      && typeof config.AWS_SECRET_ACCESS_KEY === 'string'
      && config.AWS_SECRET_ACCESS_KEY.length > 0;

    if (!hasS3) {
      logger.warn(
        'AWS S3 is not configured — material uploads use local disk (not suitable for multi-instance production)',
      );
    }
  }

  return config;
}
