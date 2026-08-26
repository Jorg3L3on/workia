import pino from "pino";

import { env } from "@/env";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      }
    : {}),
});

export const createRequestLogger = (context: Record<string, unknown>) =>
  logger.child(context);
