import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

const transport = isDev
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname,tag",
        messageFormat: "[{tag}] {msg}",
      },
    }
  : undefined;

const baseLogger = pino({
  level: process.env.LOG_LEVEL || "debug",
  transport,
});

type Logger = {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  child: (subtag: string) => Logger;
};

/**
 * Create a tagged logger
 * @example
 * const log = createLogger("agent");
 * log.info("Starting...");
 */
export function createLogger(tag: string): Logger {
  const child = baseLogger.child({ tag });

  return {
    debug: (msg, ...args) => child.debug(args.length ? { args } : {}, msg),
    info: (msg, ...args) => child.info(args.length ? { args } : {}, msg),
    warn: (msg, ...args) => child.warn(args.length ? { args } : {}, msg),
    error: (msg, ...args) => child.error(args.length ? { args } : {}, msg),
    child: (subtag) => createLogger(`${tag}:${subtag}`),
  };
}

/**
 * Set the global log level
 */
export function setLogLevel(level: string): void {
  baseLogger.level = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): string {
  return baseLogger.level;
}

// Default logger for quick usage
export const log = createLogger("app");
