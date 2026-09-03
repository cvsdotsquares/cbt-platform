import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request from 'supertest';
import { createTestApp } from './test-utils';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects login with invalid credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Tenant-ID', 'default')
      .send({
        email: 'nonexistent@example.com',
        password: 'wrong-password',
        deviceFingerprint: 'test-fp',
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Auth registration gate (e2e)', () => {
  let app: INestApplication;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PUBLIC_REGISTRATION = 'false';
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    process.env.ALLOW_PUBLIC_REGISTRATION = savedEnv.ALLOW_PUBLIC_REGISTRATION;
  });

  it('rejects public registration when disabled in production', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('X-Tenant-ID', 'default')
      .send({
        email: `test-${Date.now()}@example.com`,
        password: 'SecurePass123!',
        firstName: 'Test',
        lastName: 'User',
        deviceFingerprint: 'test-fp',
      });

    expect(res.status).toBe(403);
  });
});

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data?.status ?? res.body.status).toBe('ok');
  });

  it('GET /health/ready checks database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
  });
});
