/** Structured JSON-line logger. No console.* — output goes to stdout/stderr as JSON. */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

let threshold: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg,
    ...(fields ?? {}),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};
