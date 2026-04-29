/**
 * Cron Dispatcher Lambda
 *
 * EventBridge Rule → this Lambda → HTTP POST → SvelteKit Function URL /api/cron/:job
 *
 * Lambda Web Adapter (LWA) cannot handle raw EventBridge events — it only
 * processes HTTP requests. Therefore a thin dispatcher Lambda is required to
 * translate EventBridge payloads into HTTP calls to the SvelteKit Lambda.
 *
 * Architecture (#1376):
 *   EventBridge Rule (cron(0 15 * * ? *))
 *     → CronDispatcherFn { cronJob: 'license-expire' }
 *       → POST https://<fn-url>/api/cron/license-expire  (Bearer <CRON_SECRET>)
 *
 * Schedule SSOT: src/lib/server/cron/schedule-registry.ts
 * Auth: ADR-0033 (archive) — Bearer token (CRON_SECRET) with OPS_SECRET_KEY fallback (#1586)
 *
 * dryRun mode (#1586):
 *   `{ "cronJob": "license-expire", "dryRun": true }` を渡すと、env 検証のみ実行し
 *   実際の HTTP POST はせずに `{ statusCode: 200, dryRun: true }` を返す。
 *   deploy.yml の post-deploy smoke test で env 注入の正常性を検証する用途。
 */

import * as http from 'node:http';
import * as https from 'node:https';

// SSOT: schedule-registry.ts (inlined for CDK tsconfig rootDir compatibility)
// Matches the `endpoint` field in schedule-registry.ts exactly.
const KNOWN_ENDPOINTS: Record<string, string> = {
	'license-expire': '/api/cron/license-expire',
	'retention-cleanup': '/api/cron/retention-cleanup',
	'trial-notifications': '/api/cron/trial-notifications',
	'lifecycle-emails': '/api/cron/lifecycle-emails',
	// #1648 R43: grace-period-service.ts findExpiredSoftDeletedTenants() を呼び出す物理削除バッチ
	'grace-period-deletion': '/api/cron/grace-period-deletion',
	// #1598 (ADR-0023 I7): PMF 判定アンケート (Sean Ellis Test) 年 2 回配信
	'pmf-survey': '/api/cron/pmf-survey',
	// #1693 (#1639 follow-up): analytics 事前集計バッチ (前日分 funnel + cancellation を集計)
	'analytics-aggregator-daily': '/api/cron/analytics-aggregate',
};

interface CronEvent {
	cronJob?: string;
	/**
	 * #1586: env 注入の正常性検証用。true の場合、実際の HTTP POST はせず
	 * env 検証 + endpoint resolution のみ実行して 200 を返す。
	 */
	dryRun?: boolean;
}

interface CronResult {
	statusCode: number;
	jobName?: string;
	dryRun?: boolean;
	response?: string;
	error?: string;
}

export const handler = async (event: CronEvent): Promise<CronResult> => {
	const jobName = event.cronJob;
	if (!jobName) {
		console.error('CronDispatcher: no cronJob in event', JSON.stringify(event));
		return { statusCode: 400, error: 'no cronJob in event' };
	}

	const endpoint = KNOWN_ENDPOINTS[jobName];
	if (!endpoint) {
		console.error(`CronDispatcher: unknown cronJob "${jobName}"`);
		return { statusCode: 400, jobName, error: `unknown cronJob "${jobName}"` };
	}

	// #1586: CRON_SECRET を最優先、未設定時は OPS_SECRET_KEY に fallback。
	// L79-81 (compute-stack.ts) の後方互換設計に整合。
	const functionUrl = process.env.FUNCTION_URL;
	const secret = process.env.CRON_SECRET ?? process.env.OPS_SECRET_KEY;
	if (!functionUrl || !secret) {
		throw new Error(
			'CronDispatcher: FUNCTION_URL or (CRON_SECRET / OPS_SECRET_KEY) not set (#1586)',
		);
	}

	// #1586: dryRun mode — env 検証 + endpoint 確認のみで return。
	// post-deploy smoke test 用。実際のジョブ副作用を起こさない。
	if (event.dryRun === true) {
		console.log(
			JSON.stringify({
				level: 'info',
				message: 'CronDispatcher: dryRun OK',
				jobName,
				endpoint,
				hasFunctionUrl: Boolean(functionUrl),
				secretSource: process.env.CRON_SECRET ? 'CRON_SECRET' : 'OPS_SECRET_KEY',
			}),
		);
		return { statusCode: 200, jobName, dryRun: true };
	}

	// Strip trailing slash to avoid double-slash in path
	const url = `${functionUrl.replace(/\/$/, '')}${endpoint}`;
	console.log(JSON.stringify({ level: 'info', message: 'CronDispatcher: calling', url, jobName }));

	const { statusCode, body: responseText } = await httpPost(url, secret);
	console.log(
		JSON.stringify({
			level: 'info',
			message: 'CronDispatcher: completed',
			jobName,
			statusCode,
			response: responseText.slice(0, 200),
		}),
	);
	return { statusCode, jobName, response: responseText.slice(0, 200) };
};

// ---------------------------------------------------------------------------
// HTTP client — built-in Node.js http/https, no external dependencies
// ---------------------------------------------------------------------------

function httpPost(url: string, cronSecret: string): Promise<{ statusCode: number; body: string }> {
	return new Promise((resolve, reject) => {
		const body = JSON.stringify({});
		const parsedUrl = new URL(url);
		const isHttps = parsedUrl.protocol === 'https:';
		const client = isHttps ? https : http;

		const options: https.RequestOptions = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port || (isHttps ? 443 : 80),
			path: parsedUrl.pathname + parsedUrl.search,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${cronSecret}`,
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body),
			},
			timeout: 270_000, // 4.5 min (Lambda timeout is 5 min)
		};

		const req = client.request(options, (res) => {
			let responseBody = '';
			res.on('data', (chunk: Buffer) => {
				responseBody += chunk.toString();
			});
			res.on('end', () => {
				const statusCode = res.statusCode ?? 0;
				console.log(
					JSON.stringify({ level: 'info', message: 'CronDispatcher: response', statusCode }),
				);
				if (statusCode >= 200 && statusCode < 300) {
					resolve({ statusCode, body: responseBody });
				} else {
					reject(new Error(`CronDispatcher: HTTP ${statusCode} — ${responseBody.slice(0, 200)}`));
				}
			});
		});

		req.on('timeout', () => {
			req.destroy();
			reject(new Error(`CronDispatcher: request timed out`));
		});

		req.on('error', (err) => {
			reject(err);
		});

		req.write(body);
		req.end();
	});
}
