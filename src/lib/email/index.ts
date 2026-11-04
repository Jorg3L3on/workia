import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "@/env";
import { logger } from "@/lib/logger";

/**
 * Outgoing email (W2-01: login codes and invitations). One SMTP URL, so any
 * free sender works (a provider's free tier or the company's own server) and
 * Workia adds no paid channel. Without EMAIL_SMTP_URL, development and tests
 * write each message as a JSON file in the outbox folder; production refuses.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured (EMAIL_SMTP_URL, EMAIL_FROM).");
    this.name = "EmailNotConfiguredError";
  }
}

// Development only: keep Turbopack from tracing the whole project for this path.
const outboxDir = () =>
  path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    env.EMAIL_OUTBOX_DIR ?? ".outbox",
  );

/** True when a message can leave: SMTP in production, the outbox elsewhere. */
export const emailConfigured = () =>
  Boolean(env.EMAIL_SMTP_URL && env.EMAIL_FROM) ||
  env.NODE_ENV !== "production";

let transport: import("nodemailer").Transporter | undefined;

const smtpTransport = async () => {
  if (!transport) {
    const nodemailer = await import("nodemailer");
    transport = nodemailer.createTransport(env.EMAIL_SMTP_URL);
  }

  return transport;
};

export const sendEmail = async (message: EmailMessage) => {
  if (env.EMAIL_SMTP_URL && env.EMAIL_FROM) {
    const smtp = await smtpTransport();
    await smtp.sendMail({ from: env.EMAIL_FROM, ...message });
    return;
  }

  if (env.NODE_ENV === "production") {
    throw new EmailNotConfiguredError();
  }

  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.json`);
  await writeFile(
    file,
    JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2),
  );
  logger.info({ to: message.to, subject: message.subject, file }, "Email");
};
