export type LogLevel = "debug" | "info" | "warn" | "error";

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  public constructor(private readonly minimumLevel: LogLevel) {}

  public debug(message: string, details?: unknown): void {
    this.write("debug", message, details);
  }

  public info(message: string, details?: unknown): void {
    this.write("info", message, details);
  }

  public warn(message: string, details?: unknown): void {
    this.write("warn", message, details);
  }

  public error(message: string, details?: unknown): void {
    this.write("error", message, details);
  }

  private write(level: LogLevel, message: string, details?: unknown): void {
    if (weights[level] < weights[this.minimumLevel]) return;
    const suffix = details === undefined ? "" : ` ${formatDetails(details)}`;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

function formatDetails(details: unknown): string {
  if (details instanceof Error) return details.stack ?? details.message;
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}
