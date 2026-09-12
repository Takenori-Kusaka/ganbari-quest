// src/lib/server/logger.ts
// Structured server-side logger with file output for production
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { todayDateJST } from '$lib/domain/date-utils';

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
	// ログのローテーション単位も JST の 1 日に揃える (#4127)
	const date = todayDateJST();
	return join(LOG_DIR, `app-${date}.log`);
}

function formatEntry(entry: LogEntry): string {
	// #4947: ファイル出力も同じ redaction を通す (self-host / NUC の data/logs/*.log)
	return JSON.stringify(
		entry.context ? { ...entry, context: sanitizeContext(entry.context) } : entry,
	);
}

/**
 * #4918: `error` / `context` meta は Lambda 上ではこの関数の console 出力だけが CloudWatch への
 * 唯一の到達経路 (`isProduction && !isLambda` のときだけファイルにも書くが、Lambda では常に false)。
 * 以前は `entry.message` (固定文言) しか console に出しておらず、呼び出し側が
 * `logger.error(msg, { error: e.message, context: {...} })` で渡した DB 例外の cause が
 * 実質どこにも書かれていなかった (本番 auth-entitlement-db-unavailable 障害で原因不明のまま化)。
 */
/**
 * context の key 名で機微値を落とす (#4947)。
 *
 * #4918 で context が console (= Lambda では CloudWatch への唯一の到達経路) に出るように
 * なった結果、それまで本番のどこにも到達していなかった値が一斉に露出した。実測で平文相当の
 * おやカギコード (char code 列) と保護者メールが含まれていた。
 *
 * deny-list ではなく **key 名の部分一致**で落とす: 呼び出し側は 600 箇所以上あり、そこを
 * 全部直しても次に足された 1 箇所で破れるため、出口 1 箇所で止める。
 */
const REDACT_KEY_PATTERN =
	/pin|password|passwd|secret|token|credential|cookie|authorization|auth_?header|otp|api_?key|session|signature/i;
const MASK_EMAIL_KEY_PATTERN = /email|mail_?to|^to$|recipient/i;

function maskEmail(value: string): string {
	const at = value.indexOf('@');
	if (at <= 0) return '***';
	return `${value[0]}***${value.slice(at)}`;
}

function sanitizeContextValue(key: string, value: unknown, depth: number): unknown {
	if (REDACT_KEY_PATTERN.test(key)) return '[redacted]';
	if (MASK_EMAIL_KEY_PATTERN.test(key) && typeof value === 'string') return maskEmail(value);
	if (depth >= 4) return value;
	if (Array.isArray(value)) return value.map((v) => sanitizeContextValue(key, v, depth + 1));
	if (value && typeof value === 'object')
		return sanitizeContext(value as Record<string, unknown>, depth + 1);
	return value;
}

function sanitizeContext(context: Record<string, unknown>, depth = 0): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(context)) {
		out[k] = sanitizeContextValue(k, v, depth);
	}
	return out;
}

function formatMetaSuffix(entry: LogEntry): string {
	const parts: string[] = [];
	if (entry.error) parts.push(`error=${entry.error}`);
	if (entry.requestId) parts.push(`requestId=${entry.requestId}`);
	if (entry.tenantId) parts.push(`tenantId=${entry.tenantId}`);
	if (entry.userId) parts.push(`userId=${entry.userId}`);
	if (entry.context) {
		try {
			parts.push(`context=${JSON.stringify(sanitizeContext(entry.context))}`);
		} catch {
			// circular / non-serializable context でも他フィールドの出力は止めない
			parts.push('context=<unserializable>');
		}
	}
	return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function writeLog(entry: LogEntry) {
	if (!shouldLog(entry.level)) return;

	// Console output
	const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
	const metaSuffix = formatMetaSuffix(entry);
	const msg = entry.method
		? `${prefix} ${entry.method} ${entry.path} ${entry.status ?? ''} ${entry.durationMs ? `${entry.durationMs}ms` : ''} ${entry.message}${metaSuffix}`
		: `${prefix} ${entry.message}${metaSuffix}`;

	if (entry.level === 'critical' || entry.level === 'error') {
		console.error(msg);
		if (entry.stack) console.error(entry.stack);
	} else if (entry.level === 'warn') {
		console.warn(msg);
	} else {
		// #3692: info / debug は shouldLog を通過している (MIN_LOG_LEVEL=info) にもかかわらず
		// console 出力先が無く CloudWatch に一切出ていなかった (空 else = 握りつぶし)。
		// 本番の restore 504 調査で logger.info の observability が全滅していた根因。
		// Lambda は stdout/stderr を CloudWatch Logs に送るため console.log で出力する。
		// biome-ignore lint/suspicious/noConsole: logger 実装本体の意図的 console 出力 (info/debug を stdout へ)
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
