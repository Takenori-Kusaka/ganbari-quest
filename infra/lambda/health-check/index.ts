/**
 * External Health Check Prober Lambda
 *
 * Runs independently from the app (via EventBridge Scheduler, every 1 hour).
 * Checks /api/health and reports failures/degradation to Discord webhook.
 *
 * Monitoring layer (#1214):
 * - **This Lambda targets the Lambda Function URL directly**, not the public
 *   CloudFront domain. CloudFront has `geoRestriction('JP')` configured
 *   (infra/lib/network-stack.ts), so requests originating from us-east-1
 *   Lambda IPs are rejected with 403 before ever reaching Lambda.
 * - Scope: Lambda + DynamoDB liveness (the app tier).
 * - Out of scope: CloudFront / WAF / edge-layer failures — these need a
 *   complementary monitor (CloudWatch Synthetics from a JP-allowed IP, or
 *   an external service like UptimeRobot). Tracked separately from #1214.
 *
 * Design:
 * - Uses Node.js built-in https module (no dependencies)
 * - Notifies Discord only on failure/degraded (v1: no state tracking)
 * - Timeout: 10s per check, 30s total Lambda timeout
 * - #1469: SSM Parameter Store で週次実行統計を記憶し、週次ハートビートを Discord 通知
 */

import * as http from 'node:http';
import * as https from 'node:https';
import {
	GetParameterCommand,
	ParameterNotFound,
	PutParameterCommand,
	SSMClient,
} from '@aws-sdk/client-ssm';

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

// #1469: 週次統計の永続化型
interface WeeklyStats {
	weekStart: string; // YYYY-MM-DD (日曜 UTC = 月曜 09:00 JST 起点)
	total: number;
	normal: number;
	degraded: number;
	down: number;
	totalResponseMs: number;
}

// ----------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------

// Function URL (`https://xxx.lambda-url.us-east-1.on.aws/`) は末尾スラッシュ付きで
// 渡ってくるため、そのまま `${URL}/api/health` と連結すると `//api/health` になって
// Lambda adapter が 404 を返す。ここで必ず末尾スラッシュを剥がす。
const HEALTH_CHECK_URL = (process.env.HEALTH_CHECK_URL ?? 'https://ganbari-quest.com').replace(
	/\/+$/,
	'',
);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_HEALTH ?? '';
const REQUEST_TIMEOUT_MS = 10_000;
// #1257 G2: コールドスタート実態との乖離を解消
// Lambda init (1-2s) + SvelteKit 初期化 (1-2s) + DynamoDB DescribeTable 初回 SDK init (0.5-1s)
// = 3-5 秒は正常範囲。余裕を持って 8 秒。PMF 接近時に再評価。
const DEGRADED_THRESHOLD_MS = Number.parseInt(process.env.DEGRADED_THRESHOLD_MS ?? '8000', 10);
// #1257 G1: Discord 通知で生 URL を露出させないための論理名
// Function URL (authType: NONE) は秘密ではないが、運用通知に載せると CloudFront/WAF を
// 回避する導線を宣伝することになる。CloudWatch ログには引き続き実 URL を出力する。
const HEALTH_CHECK_LABEL = process.env.HEALTH_CHECK_LABEL ?? 'App Lambda (/api/health)';
const HEALTH_CHECK_ENVIRONMENT = process.env.HEALTH_CHECK_ENVIRONMENT ?? 'production';
// #1257 G3: 二段プローブの間隔 (1 回目 degraded/down → 10s 待ち → 2 回目)
const RETRY_DELAY_MS = Number.parseInt(process.env.HEALTH_CHECK_RETRY_DELAY_MS ?? '10000', 10);
// #1469: 週次統計保持用 SSM パラメータ名
const SSM_WEEKLY_STATS_PARAM =
	process.env.SSM_WEEKLY_STATS_PARAM ?? '/ganbari-quest/health-check/weekly-stats';

const ssmClient = new SSMClient({});

// ----------------------------------------------------------------
// Handler
// ----------------------------------------------------------------

export async function handler(): Promise<OverallStatus> {
	const timestamp = new Date().toISOString();
	const target = `${HEALTH_CHECK_URL}/api/health`;

	// #1257 G3: 二段プローブで一時的な blip を通知しない
	// 1 回目が degraded/down なら 10s 待って 2 回目を打ち、2 回目も非正常なら通知。
	const firstCheck = await checkEndpoint(target);
	let finalCheck = firstCheck;
	let retried = false;

	if (firstCheck.status !== 'ok') {
		console.warn(
			JSON.stringify({
				level: 'warn',
				message: 'first probe non-ok, retrying',
				firstCheck,
			}),
		);
		await sleep(RETRY_DELAY_MS);
		finalCheck = await checkEndpoint(target);
		retried = true;
	}

	const checks = [finalCheck];
	const overallStatus: OverallStatus['status'] =
		finalCheck.status === 'down'
			? 'down'
			: finalCheck.status === 'degraded'
				? 'degraded'
				: 'normal';

	const result: OverallStatus = {
		status: overallStatus,
		checks,
		timestamp,
	};

	// 2 回連続で非正常なときだけ Discord 通知 (silent on transient blip)
	if (overallStatus !== 'normal') {
		await notifyDiscord(result);
	} else if (retried) {
		console.log(
			JSON.stringify({
				level: 'info',
				message: 'second probe recovered, suppressing notification',
				firstCheck,
				finalCheck,
			}),
		);
	}

	// #1469: 週次統計を更新し、週が変わったらハートビートを送信
	await updateWeeklyStats(overallStatus, finalCheck.responseTimeMs);

	// Always log result for CloudWatch (生 URL は調査用に残す)
	console.log(JSON.stringify(result));

	return result;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----------------------------------------------------------------
// Weekly Stats — SSM (#1469)
// ----------------------------------------------------------------

// 日曜 00:00 UTC = 月曜 09:00 JST を週の起点とする
function getSundayWeekStart(date: Date): string {
	const d = new Date(date);
	d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay(): 0=Sun
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString().slice(0, 10);
}

async function getWeeklyStats(): Promise<WeeklyStats | null> {
	try {
		const res = await ssmClient.send(new GetParameterCommand({ Name: SSM_WEEKLY_STATS_PARAM }));
		const value = res.Parameter?.Value;
		if (!value) return null;
		const parsed = JSON.parse(value) as Partial<WeeklyStats>;
		if (typeof parsed.weekStart !== 'string') return null;
		return {
			weekStart: parsed.weekStart,
			total: parsed.total ?? 0,
			normal: parsed.normal ?? 0,
			degraded: parsed.degraded ?? 0,
			down: parsed.down ?? 0,
			totalResponseMs: parsed.totalResponseMs ?? 0,
		};
	} catch (err) {
		if (err instanceof ParameterNotFound) return null;
		console.error('SSM getWeeklyStats error:', err);
		return null;
	}
}

async function setWeeklyStats(stats: WeeklyStats): Promise<void> {
	try {
		await ssmClient.send(
			new PutParameterCommand({
				Name: SSM_WEEKLY_STATS_PARAM,
				Value: JSON.stringify(stats),
				Type: 'String',
				Overwrite: true,
			}),
		);
	} catch (err) {
		console.error('SSM setWeeklyStats error:', err);
	}
}

async function updateWeeklyStats(
	status: OverallStatus['status'],
	responseTimeMs: number,
): Promise<void> {
	const currentWeekStart = getSundayWeekStart(new Date());
	const prevStats = await getWeeklyStats();

	if (prevStats !== null && prevStats.weekStart !== currentWeekStart) {
		// 週が切り替わった → 前週のサマリーをハートビートとして送信してからリセット
		await notifyDiscordHeartbeat(prevStats);
		const newStats: WeeklyStats = {
			weekStart: currentWeekStart,
			total: 1,
			normal: status === 'normal' ? 1 : 0,
			degraded: status === 'degraded' ? 1 : 0,
			down: status === 'down' ? 1 : 0,
			totalResponseMs: responseTimeMs,
		};
		await setWeeklyStats(newStats);
	} else {
		const updated: WeeklyStats = {
			weekStart: currentWeekStart,
			total: (prevStats?.total ?? 0) + 1,
			normal: (prevStats?.normal ?? 0) + (status === 'normal' ? 1 : 0),
			degraded: (prevStats?.degraded ?? 0) + (status === 'degraded' ? 1 : 0),
			down: (prevStats?.down ?? 0) + (status === 'down' ? 1 : 0),
			totalResponseMs: (prevStats?.totalResponseMs ?? 0) + responseTimeMs,
		};
		await setWeeklyStats(updated);
	}
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

	// #1257 G1: 生 URL の代わりに論理名を表示
	const checkDetails = result.checks
		.map((c) => {
			if (c.status === 'ok') {
				return `\u{1F7E2} ${HEALTH_CHECK_LABEL} | ${c.responseTimeMs}ms`;
			}
			if (c.status === 'degraded') {
				return `\u{1F7E1} ${HEALTH_CHECK_LABEL} | ${c.responseTimeMs}ms (slow)`;
			}
			return `\u{1F534} ${HEALTH_CHECK_LABEL} | ${c.error ?? `HTTP ${c.statusCode}`}`;
		})
		.join('\n');

	const embed = {
		title: `${statusEmoji} Health Check: ${statusLabel}`,
		description: checkDetails,
		color: result.status === 'down' ? 0xff0000 : 0xffcc00,
		fields: [
			{
				name: '環境',
				value: HEALTH_CHECK_ENVIRONMENT,
				inline: true,
			},
			{
				name: 'Timestamp',
				value: result.timestamp,
				inline: true,
			},
		],
		timestamp: result.timestamp,
	};

	await postDiscordEmbed(embed);
}

// #1469: 週次ハートビート通知
async function notifyDiscordHeartbeat(stats: WeeklyStats): Promise<void> {
	if (!DISCORD_WEBHOOK_URL) {
		console.log('DISCORD_WEBHOOK_HEALTH not set, skipping heartbeat notification');
		return;
	}

	const avgResponseMs = stats.total > 0 ? Math.round(stats.totalResponseMs / stats.total) : 0;
	const weekEndDate = new Date(`${stats.weekStart}T00:00:00Z`);
	weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
	const weekRange = `${stats.weekStart} 〜 ${weekEndDate.toISOString().slice(0, 10)}`;

	const embed = {
		title: '\u{1F49A} HealthCheck 週次サマリー',
		description: '監視が正常に稼働しています。',
		color: 0x00cc44,
		fields: [
			{ name: '期間', value: weekRange, inline: false },
			{ name: '実行回数', value: `${stats.total} 回`, inline: true },
			{ name: '正常', value: `${stats.normal} 回`, inline: true },
			{
				name: '異常（degraded + down）',
				value: `${stats.degraded + stats.down} 回`,
				inline: true,
			},
			{ name: '平均応答時間', value: `${avgResponseMs.toLocaleString()}ms`, inline: true },
			{ name: '環境', value: HEALTH_CHECK_ENVIRONMENT, inline: true },
		],
		timestamp: new Date().toISOString(),
	};

	console.log(
		JSON.stringify({
			level: 'info',
			message: 'sending weekly heartbeat notification',
			weekStart: stats.weekStart,
			total: stats.total,
			normal: stats.normal,
			degraded: stats.degraded,
			down: stats.down,
		}),
	);

	await postDiscordEmbed(embed);
}

async function postDiscordEmbed(embed: object): Promise<void> {
	try {
		const payload = JSON.stringify({ embeds: [embed] });

		await new Promise<void>((resolve, _reject) => {
			const url = new URL(DISCORD_WEBHOOK_URL);
			const isHttps = url.protocol === 'https:';
			const client = isHttps ? https : http;
			const options: https.RequestOptions = {
				hostname: url.hostname,
				port: url.port ? Number(url.port) : isHttps ? 443 : 80,
				path: url.pathname + url.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload),
				},
				timeout: 5_000,
			};

			const req = client.request(options, (res) => {
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
