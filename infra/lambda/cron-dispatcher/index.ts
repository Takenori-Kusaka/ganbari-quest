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
 * Auth: ADR-0033 (archive) — Bearer token (CRON_SECRET)
 */

import * as http from 'node:http';
import * as https from 'node:https';

// SSOT: schedule-registry.ts (inlined for CDK tsconfig rootDir compatibility)
// Matches the `endpoint` field in schedule-registry.ts exactly.
const KNOWN_ENDPOINTS: Record<string, string> = {
	'license-expire': '/api/cron/license-expire',
	'retention-cleanup': '/api/cron/retention-cleanup',
	'trial-notifications': '/api/cron/trial-notifications',
};

interface CronEvent {
	cronJob?: string;
}

export const handler = async (event: CronEvent): Promise<void> => {
	const jobName = event.cronJob;
	if (!jobName) {
		console.error('CronDispatcher: no cronJob in event', JSON.stringify(event));
		return;
	}

	const endpoint = KNOWN_ENDPOINTS[jobName];
	if (!endpoint) {
		console.error(`CronDispatcher: unknown cronJob "${jobName}"`);
		return;
	}

	const functionUrl = process.env.FUNCTION_URL;
	const cronSecret = process.env.CRON_SECRET;
	if (!functionUrl || !cronSecret) {
		throw new Error('CronDispatcher: FUNCTION_URL or CRON_SECRET not set');
	}

	// Strip trailing slash to avoid double-slash in path
	const url = `${functionUrl.replace(/\/$/, '')}${endpoint}`;
	console.log(JSON.stringify({ level: 'info', message: 'CronDispatcher: calling', url, jobName }));

	const responseText = await httpPost(url, cronSecret);
	console.log(
		JSON.stringify({
			level: 'info',
			message: 'CronDispatcher: completed',
			jobName,
			response: responseText.slice(0, 200),
		}),
	);
};

// ---------------------------------------------------------------------------
// HTTP client — built-in Node.js http/https, no external dependencies
// ---------------------------------------------------------------------------

function httpPost(url: string, cronSecret: string): Promise<string> {
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
					resolve(responseBody);
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
