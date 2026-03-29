// src/lib/server/logger.ts
// Structured server-side logger with file output for production
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	error?: string;
	stack?: string;
	requestId?: string;
	tenantId?: string;
	userId?: string;
	service?: string;
	context?: Record<string, unknown>;
}

const LEVEL_VALUES: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	critical: 50,
};

const LOG_DIR = join(process.cwd(), 'data', 'logs');
const isProduction = process.env.NODE_ENV === 'production';
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const MIN_LOG_LEVEL: LogLevel =
	(process.env.LOG_LEVEL as LogLevel) ?? (isProduction ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
	return LEVEL_VALUES[level] >= LEVEL_VALUES[MIN_LOG_LEVEL];
}

function ensureLogDir() {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
}

function getLogFileName(): string {
	const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	return join(LOG_DIR, `app-${date}.log`);
}

function formatEntry(entry: LogEntry): string {
	return JSON.stringify(entry);
}

function writeLog(entry: LogEntry) {
	if (!shouldLog(entry.level)) return;

	// Console output
	const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
	const msg = entry.method
		? `${prefix} ${entry.method} ${entry.path} ${entry.status ?? ''} ${entry.durationMs ? `${entry.durationMs}ms` : ''} ${entry.message}`
		: `${prefix} ${entry.message}`;

	if (entry.level === 'critical' || entry.level === 'error') {
		console.error(msg);
		if (entry.stack) console.error(entry.stack);
	} else if (entry.level === 'warn') {
		console.warn(msg);
	} else {
		console.log(msg);
	}

	// File output (production only, skip on Lambda — CloudWatch Logs handles it)
	if (isProduction && !isLambda) {
		try {
			ensureLogDir();
			appendFileSync(getLogFileName(), `${formatEntry(entry)}\n`);
		} catch {
			// Avoid recursive logging failures
			console.error('Failed to write log file');
		}
	}
}

export const logger = {
	debug(message: string, meta?: Partial<LogEntry>) {
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'debug',
			message,
			...meta,
		});
	},

	info(message: string, meta?: Partial<LogEntry>) {
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'info',
			message,
			...meta,
		});
	},

	warn(message: string, meta?: Partial<LogEntry>) {
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'warn',
			message,
			...meta,
		});
	},

	error(message: string, meta?: Partial<LogEntry>) {
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'error',
			message,
			...meta,
		});
	},

	critical(message: string, meta?: Partial<LogEntry>) {
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'critical',
			message,
			...meta,
		});
	},

	/** Log an HTTP request with duration and status */
	request(
		method: string,
		path: string,
		status: number,
		durationMs: number,
		extra?: { requestId?: string; tenantId?: string },
	) {
		const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
		writeLog({
			timestamp: new Date().toISOString(),
			level,
			message: '',
			method,
			path,
			status,
			durationMs,
			requestId: extra?.requestId,
			tenantId: extra?.tenantId,
		});
	},

	/** Log a caught error with full context */
	requestError(method: string, path: string, err: unknown, requestId?: string, tenantId?: string) {
		const error = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error ? err.stack : undefined;
		writeLog({
			timestamp: new Date().toISOString(),
			level: 'error',
			message: error,
			method,
			path,
			error,
			stack,
			requestId,
			tenantId,
		});
	},
};
