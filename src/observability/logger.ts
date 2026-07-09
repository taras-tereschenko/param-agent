import { redactValue } from "../security/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Structured JSON logger. All fields pass through secret redaction before
 * being written, so tokens/keys never leak into logs.
 */
export class Logger {
  constructor(
    private readonly level: LogLevel = "info",
    private readonly component = "param",
    private readonly sink: (line: string) => void = (line) =>
      process.stdout.write(`${line}\n`),
  ) {}

  child(component: string): Logger {
    return new Logger(this.level, component, this.sink);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log("debug", message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log("warn", message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.log("error", message, fields);
  }

  private log(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }
    const record = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...(fields ? (redactValue(fields) as Record<string, unknown>) : {}),
    };
    this.sink(JSON.stringify(record));
  }
}

export const logger = new Logger(
  (process.env.PARAM_LOG_LEVEL as LogLevel) || "info",
);
