/**
 * External Health Check Prober Lambda
 *
 * Runs independently from the app (via EventBridge Scheduler, every 1 hour).
 * Checks /api/health and reports failures/degradation to Discord webhook.
 *
 * Design:
 * - Uses Node.js built-in https module (no dependencies)
 * - Notifies Discord only on failure/degraded (v1: no state tracking)
 * - Timeout: 10s per check, 30s total Lambda timeout
 */

import * as http from 'node:http';
import * as https from 'node:https';

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

interface HealthCheckResult {
	endpoint: string;
	status: 'ok' | 'degraded' | 'down';
	responseTimeMs: number;
	statusCode?: number;
	error?: string;
}

interface OverallStatus {
	status: 'normal' | 'degraded' | 'down';
	checks: HealthCheckResult[];
	timestamp: string;
}

// ----------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------

const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL ?? 'https://ganbari-quest.com';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_HEALTH ?? '';
const REQUEST_TIMEOUT_MS = 10_000;
const DEGRADED_THRESHOLD_MS = 3_000;

// ----------------------------------------------------------------
// Handler
// ----------------------------------------------------------------

export async function handler(): Promise<OverallStatus> {
	const timestamp = new Date().toISOString();

	const healthCheck = await checkEndpoint(`${HEALTH_CHECK_URL}/api/health`);

	const checks = [healthCheck];

	// Determine overall status
	const hasDown = checks.some((c) => c.status === 'down');
	const hasDegraded = checks.some((c) => c.status === 'degraded');

	let overallStatus: OverallStatus['status'];
	if (hasDown) {
		overallStatus = 'down';
	} else if (hasDegraded) {
		overallStatus = 'degraded';
	} else {
		overallStatus = 'normal';
	}

	const result: OverallStatus = {
		status: overallStatus,
		checks,
		timestamp,
	};

	// v1: Only notify Discord on failure/degraded (skip success to avoid noise)
	if (overallStatus !== 'normal') {
		await notifyDiscord(result);
	}

	// Always log result for CloudWatch
	console.log(JSON.stringify(result));

	return result;
}

// ----------------------------------------------------------------
// Health Check
// ----------------------------------------------------------------

async function checkEndpoint(url: string): Promise<HealthCheckResult> {
	const start = Date.now();

	try {
		const { statusCode } = await httpGet(url, REQUEST_TIMEOUT_MS);
		const responseTimeMs = Date.now() - start;

		if (statusCode !== 200) {
			return {
				endpoint: url,
				status: 'down',
				responseTimeMs,
				statusCode,
				error: `Unexpected status code: ${statusCode}`,
			};
		}

		if (responseTimeMs > DEGRADED_THRESHOLD_MS) {
			return {
				endpoint: url,
				status: 'degraded',
				responseTimeMs,
				statusCode,
			};
		}

		return {
			endpoint: url,
			status: 'ok',
			responseTimeMs,
			statusCode,
		};
	} catch (err) {
		const responseTimeMs = Date.now() - start;
		const errorMessage = err instanceof Error ? err.message : String(err);

		return {
			endpoint: url,
			status: 'down',
			responseTimeMs,
			error: errorMessage,
		};
	}
}

// ----------------------------------------------------------------
// HTTP client (built-in, no dependencies)
// ----------------------------------------------------------------

function httpGet(url: string, timeoutMs: number): Promise<{ statusCode: number; body: string }> {
	return new Promise((resolve, reject) => {
		const client = url.startsWith('https') ? https : http;

		const req = client.get(url, { timeout: timeoutMs }, (res) => {
			let body = '';
			res.on('data', (chunk: Buffer) => {
				body += chunk.toString();
			});
			res.on('end', () => {
				resolve({ statusCode: res.statusCode ?? 0, body });
			});
		});

		req.on('timeout', () => {
			req.destroy();
			reject(new Error(`Request timed out after ${timeoutMs}ms`));
		});

		req.on('error', (err) => {
			reject(err);
		});
	});
}

// ----------------------------------------------------------------
// Discord Notification
// ----------------------------------------------------------------

async function notifyDiscord(result: OverallStatus): Promise<void> {
	if (!DISCORD_WEBHOOK_URL) {
		console.log('DISCORD_WEBHOOK_HEALTH not set, skipping notification');
		return;
	}

	const statusEmoji = result.status === 'down' ? '\u{1F534}' : '\u{1F7E1}'; // Red or Yellow circle
	const statusLabel = result.status === 'down' ? 'down' : 'degraded';

	const checkDetails = result.checks
		.map((c) => {
			if (c.status === 'ok') {
				return `\u{1F7E2} ${c.endpoint} | ${c.responseTimeMs}ms`;
			}
			if (c.status === 'degraded') {
				return `\u{1F7E1} ${c.endpoint} | ${c.responseTimeMs}ms (slow)`;
			}
			return `\u{1F534} ${c.endpoint} | ${c.error ?? `HTTP ${c.statusCode}`}`;
		})
		.join('\n');

	const embed = {
		title: `${statusEmoji} Health Check: ${statusLabel}`,
		description: checkDetails,
		color: result.status === 'down' ? 0xff0000 : 0xffcc00,
		fields: [
			{
				name: 'Timestamp',
				value: result.timestamp,
				inline: true,
			},
		],
		timestamp: result.timestamp,
	};

	try {
		const payload = JSON.stringify({ embeds: [embed] });

		await new Promise<void>((resolve, reject) => {
			const url = new URL(DISCORD_WEBHOOK_URL);
			const options: https.RequestOptions = {
				hostname: url.hostname,
				port: 443,
				path: url.pathname + url.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload),
				},
				timeout: 5_000,
			};

			const req = https.request(options, (res) => {
				let body = '';
				res.on('data', (chunk: Buffer) => {
					body += chunk.toString();
				});
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
						resolve();
					} else {
						console.error('Discord webhook failed:', res.statusCode, body);
						resolve(); // Don't fail the Lambda on notification failure
					}
				});
			});

			req.on('timeout', () => {
				req.destroy();
				console.error('Discord webhook timed out');
				resolve();
			});

			req.on('error', (err) => {
				console.error('Discord webhook error:', err);
				resolve(); // Don't fail the Lambda on notification failure
			});

			req.write(payload);
			req.end();
		});
	} catch (e) {
		console.error('Discord notification error:', e);
	}
}
