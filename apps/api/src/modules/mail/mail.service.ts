import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user: this.config.get('SMTP_USER'),
          pass: this.config.get('SMTP_PASS'),
        },
      });
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    const from = this.config.get('SMTP_FROM', 'noreply@cbt-platform.com');

    if (!this.transporter) {
      this.logger.log(`[DEV MAIL] To: ${to} | Subject: ${subject}`);
      this.logger.log(`[DEV MAIL] Body preview: ${html.replace(/<[^>]+>/g, '').slice(0, 200)}...`);
      return;
    }

    await this.transporter.sendMail({ from, to, subject, html });
  }
}
