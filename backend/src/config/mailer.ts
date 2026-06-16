import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import logger from './logger';

let transporter: Transporter | null = null;

export function createMailTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,           // Use pooled connections
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,      // 1 second between messages
    rateLimit: 5,         // max 5 messages per rateDelta
  });

  logger.info('📧 Nodemailer SMTP transporter initialized', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
  });

  return transporter;
}

export async function verifyMailConnection(): Promise<boolean> {
  try {
    const t = createMailTransporter();
    await t.verify();
    logger.info('✅ SMTP connection verified successfully');
    return true;
  } catch (err) {
    const error = err as Error;
    logger.warn('⚠️  SMTP verification failed (emails may not send)', { error: error.message });
    return false;
  }
}

export interface MailPayload {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: SendMailOptions['attachments'];
}

export async function sendMail(payload: MailPayload): Promise<{ messageId: string }> {
  const t = createMailTransporter();

  const mailOptions: SendMailOptions = {
    from: `"${process.env.SMTP_FROM_NAME || 'Email Sequencing'}" <${process.env.SMTP_FROM_EMAIL}>`,
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    replyTo: payload.replyTo,
    attachments: payload.attachments,
  };

  const info = await t.sendMail(mailOptions);
  logger.info('📨 Email sent', { messageId: info.messageId, to: payload.to });
  return { messageId: info.messageId as string };
}
