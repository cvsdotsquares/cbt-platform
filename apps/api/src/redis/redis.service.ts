import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
      this.client.connect().catch((err) => {
        this.logger.warn(`Redis unavailable, using in-memory fallback: ${err.message}`);
        this.client = null;
      });
    }
  }

  get isAvailable(): boolean {
    return this.client?.status === 'ready';
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async incr(key: string, ttlMs: number): Promise<{ totalHits: number; timeToExpire: number }> {
    if (!this.client) {
      return { totalHits: 1, timeToExpire: Math.ceil(ttlMs / 1000) };
    }
    const multi = this.client.multi();
    multi.incr(key);
    multi.pttl(key);
    const results = await multi.exec();
    const totalHits = (results?.[0]?.[1] as number) || 1;
    let timeToExpireMs = (results?.[1]?.[1] as number) || -1;
    if (timeToExpireMs < 0) {
      await this.client.pexpire(key, ttlMs);
      timeToExpireMs = ttlMs;
    }
    return { totalHits, timeToExpire: Math.ceil(timeToExpireMs / 1000) };
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }
}
