/**
 * Log levels for the client-side logger
 * Higher levels include all lower level logs
 * ERROR (0) - Only critical errors
 * WARN (1) - Warnings and errors
 * INFO (2) - Important events (connections, chat, announcements) + warn/error
 * DEBUG (3) - Everything including high-frequency events (player input, game state)
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.WARN]: "WARN",
  [LogLevel.INFO]: "INFO",
  [LogLevel.DEBUG]: "DEBUG",
};

const levelFromString: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

class Logger {
  private level: LogLevel;

  constructor() {
    // Default to INFO, can be overridden by environment variable
    const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL?.toLowerCase();
    this.level =
      envLevel && levelFromString[envLevel] !== undefined
        ? levelFromString[envLevel]
        : LogLevel.INFO;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setLevelFromString(levelStr: string): boolean {
    const level = levelFromString[levelStr.toLowerCase()];
    if (level !== undefined) {
      this.level = level;
      return true;
    }
    return false;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  getLevelName(): string {
    return levelNames[this.level];
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${levelNames[level]}] ${message}`;
  }

  /**
   * Debug logs for high-frequency, verbose messages
   * Use for: player input, game state updates, internal state changes
   */
  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage(LogLevel.DEBUG, message), ...args);
    }
  }

  /**
   * Info logs for important events
   * Use for: player connect/disconnect, chat messages, announcements
   */
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage(LogLevel.INFO, message), ...args);
    }
  }

  /**
   * Warn logs for warning-level messages
   * Use for: deprecated API usage, recoverable errors, unknown message types
   */
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage(LogLevel.WARN, message), ...args);
    }
  }

  /**
   * Error logs for critical failures
   * Use for: failures that need attention, unrecoverable errors
   */
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage(LogLevel.ERROR, message), ...args);
    }
  }
}

// Export a singleton instance
export const logger = new Logger();

// Export for convenience
export default logger;
