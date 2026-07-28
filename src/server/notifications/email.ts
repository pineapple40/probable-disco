import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Logs the email instead of sending it. Used whenever SMTP is not configured. */
class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "[DEV EMAIL] No SMTP configured - logging email instead of sending",
    );
  }
}

class SmtpEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT) || 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (!provider) {
    provider = env.SMTP_HOST ? new SmtpEmailProvider() : new ConsoleEmailProvider();
  }
  return provider;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await getEmailProvider().send(message);
}
