import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private memory = new Map<string, { hits: number; expiresAt: number; blockedUntil: number }>();

  constructor(private redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (this.redis.isAvailable) {
      const blockKey = `${key}:blocked`;
      const client = this.redis.getClient()!;
      const blockedTtl = await client.pttl(blockKey);
      if (blockedTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: 0,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockedTtl / 1000),
        };
      }
      const { totalHits, timeToExpire } = await this.redis.incr(`throttle:${key}`, ttl);
      if (totalHits > limit) {
        await client.set(blockKey, '1', 'PX', blockDuration);
        return {
          totalHits,
          timeToExpire,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }
      return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 };
    }

    const now = Date.now();
    const entry = this.memory.get(key);
    if (entry && entry.blockedUntil > now) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil((entry.blockedUntil - now) / 1000),
      };
    }
    if (!entry || entry.expiresAt <= now) {
      this.memory.set(key, { hits: 1, expiresAt: now + ttl, blockedUntil: 0 }); // ttl in ms
      return { totalHits: 1, timeToExpire: ttl, isBlocked: false, timeToBlockExpire: 0 };
    }
    entry.hits += 1;
    if (entry.hits > limit) {
      entry.blockedUntil = now + blockDuration;
      return {
        totalHits: entry.hits,
        timeToExpire: Math.ceil((entry.expiresAt - now) / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockDuration / 1000),
      };
    }
    return {
      totalHits: entry.hits,
      timeToExpire: Math.ceil((entry.expiresAt - now) / 1000),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
