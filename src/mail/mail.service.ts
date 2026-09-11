import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailMessage, MailTemplate, MailTemplateResult } from './mail.interfaces';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    this.fromAddress = this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('SMTP_USER') ?? '';
  }

  /**
   * Built lazily (not in the constructor) so a missing/invalid SMTP_* config fails the first send
   * attempt with a clear, logged error instead of crashing the whole app at boot — SMTP delivery is
   * a best-effort side effect of approval/deposit flows, never something that should stop the API
   * from starting. Logs config as loaded (host/port/user/from — never the password) exactly once,
   * the first time a transporter is actually needed.
   */
  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST')?.trim();
    const port = this.config.get<string>('SMTP_PORT')?.trim();
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const password = this.config.get<string>('SMTP_PASSWORD');

    if (!host || !port || !user || !password) {
      throw new Error(
        'SMTP is not configured — set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD in the environment.',
      );
    }

    this.logger.log(
      `[SMTP] Configuration loaded — host=${host} port=${port} user=${maskEmail(user)} from=${maskEmail(this.fromAddress)}`,
    );

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass: password },
    });

    return this.transporter;
  }

  /**
   * Low-level send — every email type in the app funnels through here, so SMTP wiring, the from
   * address, and error handling/logging live in exactly one place. Never throws: a delivery failure
   * is logged and reported back via the return value instead, so a caller (typically an event
   * listener running after a DB transaction has already committed) can record the failure for retry
   * without that failure ever propagating back into request/transaction handling.
   *
   * Logs each checkpoint a support engineer needs to tell "never tried", "auth/connection rejected"
   * and "server accepted the message" apart, without ever printing SMTP_PASSWORD or the recipient's
   * full address. Office 365 in particular can authenticate successfully and still reject the send
   * itself (e.g. SendAsDenied when SMTP_USER isn't permitted to send as SMTP_FROM) — that failure
   * surfaces from sendMail, not verify(), so it is reported here with the server's own response
   * text/code rather than a generic message.
   */
  async send(message: MailMessage): Promise<{ sent: boolean; error?: string }> {
    const maskedTo = maskEmail(message.to);
    this.logger.log(`[SMTP] Attempting to send activation email to: ${maskedTo}`);

    let transporter: nodemailer.Transporter;
    try {
      transporter = this.getTransporter();
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error('[SMTP] Email sending failed');
      this.logger.error(`[SMTP] Error: ${error}`);
      return { sent: false, error };
    }

    try {
      await transporter.verify();
      this.logger.log('[SMTP] SMTP connection/auth successful');
    } catch (err) {
      const error = describeSmtpError(err);
      this.logger.error('[SMTP] Email sending failed');
      this.logger.error(`[SMTP] Error: ${error}`);
      return { sent: false, error };
    }

    try {
      const info = await transporter.sendMail({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      this.logger.log(`[SMTP] Email sent successfully - messageId: ${info.messageId}`);
      return { sent: true };
    } catch (err) {
      const error = describeSmtpError(err);
      this.logger.error('[SMTP] Email sending failed');
      this.logger.error(`[SMTP] Error: ${error}`);
      return { sent: false, error };
    }
  }

  /** Renders a template with its variables, then sends it — the one call site most callers need. */
  async sendTemplate<TVariables>(
    to: string,
    template: MailTemplate<TVariables>,
    variables: TVariables,
  ): Promise<{ sent: boolean; error?: string }> {
    const rendered: MailTemplateResult = template(variables);
    return this.send({ to, ...rendered });
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const maskedLocal = local.length <= 2 ? '*'.repeat(local.length) : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
  return `${maskedLocal}@${domain}`;
}

/**
 * Nodemailer/SMTP errors carry the server's own response text (`response`), SMTP status code
 * (`responseCode`) and a short error class (`code`, e.g. 'EAUTH') alongside `message` — none of
 * which ever include SMTP_PASSWORD or any credential. Surfacing them verbatim is what lets a
 * failure like Office 365's SendAsDenied (auth succeeds, then the send itself is rejected because
 * SMTP_USER isn't permitted to send as SMTP_FROM) be diagnosed from the log instead of collapsing
 * into a generic "failed to send".
 */
function describeSmtpError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: string; responseCode?: number; response?: string };
    const parts = [e.message].filter(Boolean) as string[];
    if (e.code) parts.push(`code=${e.code}`);
    if (e.responseCode) parts.push(`responseCode=${e.responseCode}`);
    if (e.response) parts.push(`response=${e.response}`);
    if (parts.length) return parts.join(' | ');
  }
  return err instanceof Error ? err.message : String(err);
}
