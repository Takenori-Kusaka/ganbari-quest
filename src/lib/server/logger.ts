// src/lib/server/logger.ts
// Structured server-side logger with file output for production
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	error?: string;
	stack?: string;
	context?: Record<string, unknown>;
}

const LOG_DIR = join(process.cwd(), 'data', 'logs');
const isProduction = process.env.NODE_ENV === 'production';

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
	// Console output
	const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
	const msg = entry.method
		? `${prefix} ${entry.method} ${entry.path} ${entry.status ?? ''} ${entry.durationMs ? `${entry.durationMs}ms` : ''} ${entry.message}`
		: `${prefix} ${entry.message}`;

	if (entry.level === 'error') {
		console.error(msg);
		if (entry.stack) console.error(entry.stack);
	} else if (entry.level === 'warn') {
		console.warn(msg);
	} else {
		console.log(msg);
	}

	// File output (production only to avoid dev noise)
	if (isProduction) {
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

	/** Log an HTTP request with duration and status */
	request(method: string, path: string, status: number, durationMs: number) {
		const level: LogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
		writeLog({
			timestamp: new Date().toISOString(),
			level,
			message: '',
			method,
			path,
			status,
			durationMs,
		});
	},

	/** Log a caught error with full context */
	requestError(method: string, path: string, err: unknown) {
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
		});
	},
};
