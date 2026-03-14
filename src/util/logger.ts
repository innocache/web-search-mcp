import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  request_id?: string;
  tool_name?: string;
  query?: string;
  url?: string;
  elapsed_ms?: number;
  extraction_score?: number;
  result_count?: number;
  warning_count?: number;
  error_code?: string;
  message: string;
  [key: string]: unknown;
}

// All logs go to stderr — stdout is reserved for MCP protocol traffic
function writeLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;
  console.error(JSON.stringify(entry));
}

export function createRequestLogger(toolName: string) {
  const requestId = randomUUID().slice(0, 8);
  const startTime = Date.now();

  return {
    requestId,
    debug(message: string, extra?: Record<string, unknown>) {
      writeLog({ level: 'debug', timestamp: new Date().toISOString(), request_id: requestId, tool_name: toolName, message, ...extra });
    },
    info(message: string, extra?: Record<string, unknown>) {
      writeLog({ level: 'info', timestamp: new Date().toISOString(), request_id: requestId, tool_name: toolName, message, ...extra });
    },
    warn(message: string, extra?: Record<string, unknown>) {
      writeLog({ level: 'warn', timestamp: new Date().toISOString(), request_id: requestId, tool_name: toolName, message, ...extra });
    },
    error(message: string, extra?: Record<string, unknown>) {
      writeLog({ level: 'error', timestamp: new Date().toISOString(), request_id: requestId, tool_name: toolName, message, ...extra });
    },
    elapsed(): number {
      return Date.now() - startTime;
    },
    done(extra?: Record<string, unknown>) {
      writeLog({ level: 'info', timestamp: new Date().toISOString(), request_id: requestId, tool_name: toolName, message: 'completed', elapsed_ms: Date.now() - startTime, ...extra });
    },
  };
}

export function logStartup(message: string): void {
  writeLog({ level: 'info', timestamp: new Date().toISOString(), message });
}

export function logFatal(message: string, extra?: Record<string, unknown>): void {
  writeLog({ level: 'error', timestamp: new Date().toISOString(), message, ...extra });
}
