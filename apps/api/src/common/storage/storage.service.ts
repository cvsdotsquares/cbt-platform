import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import type { ReadStream } from 'fs';

const S3_PREFIX = 's3:';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadDir: string;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string | null;

  constructor(private config: ConfigService) {
    this.uploadDir =
      this.config.get<string>('UPLOAD_DIR') || path.join(process.cwd(), 'uploads', 'materials');

    const bucket = this.config.get<string>('AWS_S3_BUCKET');
    const accessKey = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');

    if (bucket && accessKey && secretKey) {
      this.s3Bucket = bucket;
      this.s3Client = new S3Client({
        region,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      });
      this.logger.log(`Using S3 storage bucket: ${bucket}`);
    } else {
      this.s3Bucket = null;
      this.s3Client = null;
      fs.mkdir(this.uploadDir, { recursive: true }).catch((e) => {
        this.logger.error(`Failed to create upload directory: ${e}`);
      });
    }
  }

  get isS3Enabled(): boolean {
    return Boolean(this.s3Client && this.s3Bucket);
  }

  private s3Key(storageKey: string): string {
    return storageKey.startsWith(S3_PREFIX) ? storageKey.slice(S3_PREFIX.length) : storageKey;
  }

  isS3Ref(fileUrl: string): boolean {
    return fileUrl.startsWith(S3_PREFIX);
  }

  async save(
    tenantId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    const safeName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const key = `materials/${tenantId}/${safeName}`;

    if (this.s3Client && this.s3Bucket) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      return `${S3_PREFIX}${key}`;
    }

    const tenantDir = path.join(this.uploadDir, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });
    const filePath = path.join(tenantDir, safeName);
    await fs.writeFile(filePath, buffer);
    return filePath;
  }

  async readBuffer(fileUrl: string): Promise<Buffer> {
    if (this.isS3Ref(fileUrl)) {
      if (!this.s3Client || !this.s3Bucket) {
        throw new NotFoundException('S3 storage is not configured');
      }
      const response = await this.s3Client.send(
        new GetObjectCommand({ Bucket: this.s3Bucket, Key: this.s3Key(fileUrl) }),
      );
      const body = response.Body;
      if (!body) throw new NotFoundException('File not found');
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }

    const filePath = path.isAbsolute(fileUrl) ? fileUrl : path.resolve(process.cwd(), fileUrl);
    try {
      return await fs.readFile(filePath);
    } catch {
      throw new NotFoundException('File not found on server. Try re-uploading.');
    }
  }

  async getReadStream(fileUrl: string): Promise<ReadStream> {
    if (this.isS3Ref(fileUrl)) {
      const buffer = await this.readBuffer(fileUrl);
      const { Readable: NodeReadable } = await import('stream');
      return NodeReadable.from(buffer) as unknown as ReadStream;
    }

    const filePath = path.isAbsolute(fileUrl) ? fileUrl : path.resolve(process.cwd(), fileUrl);
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File not found on server. Try re-uploading.');
    }
    return createReadStream(filePath);
  }

  async delete(fileUrl: string): Promise<void> {
    if (this.isS3Ref(fileUrl)) {
      if (!this.s3Client || !this.s3Bucket) return;
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({ Bucket: this.s3Bucket, Key: this.s3Key(fileUrl) }),
        );
      } catch (e) {
        this.logger.warn(`S3 delete failed for ${fileUrl}: ${e}`);
      }
      return;
    }

    try {
      await fs.unlink(fileUrl);
    } catch {
      /* ignore missing local files */
    }
  }
}
