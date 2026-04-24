// src/lib/server/discord-alert.ts
// Discord アラート通知（スロットリング付き）

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';

export interface AlertOptions {
	level: 'error' | 'critical';
	message: string;
	method?: string;
	path?: string;
	status?: number;
	requestId?: string;
	tenantId?: string;
	errorSummary?: string;
	stackSummary?: string;
}

// スロットリング用メモリマップ
const alertThrottleMap = new Map<
	string,
	{ count: number; firstAt: number; requestIds: string[] }
>();
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5分
const THROTTLE_THRESHOLD = 3;

/** スロットリング状態をクリーンアップ（期限切れのみ） */
function cleanupThrottleMap(): void {
	const now = Date.now();
	for (const [key, entry] of alertThrottleMap) {
		if (now - entry.firstAt > THROTTLE_WINDOW_MS) {
			alertThrottleMap.delete(key);
		}
	}
}

/** テスト用: スロットリングマップをリセット */
export function _resetThrottleMap(): void {
	alertThrottleMap.clear();
}

/** テスト用: スロットリングマップの状態を返す */
export function _getThrottleMap(): Map<
	string,
	{ count: number; firstAt: number; requestIds: string[] }
> {
	return alertThrottleMap;
}

function getAlertWebhookUrl(): string | undefined {
	return env.DISCORD_ALERT_WEBHOOK_URL ?? env.DISCORD_WEBHOOK_INCIDENT;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: 既存コード、別Issueで対応予定
export async function sendDiscordAlert(options: AlertOptions): Promise<void> {
	const webhookUrl = getAlertWebhookUrl();
	if (!webhookUrl) return;

	// クリーンアップ
	cleanupThrottleMap();

	// スロットリング判定
	const key = `${options.path ?? ''}:${options.errorSummary ?? options.message}`;
	const existing = alertThrottleMap.get(key);
	const now = Date.now();

	if (existing) {
		existing.count++;
		if (options.requestId) {
			existing.requestIds.push(options.requestId);
		}

		// ウィンドウ内でスレッショルドを超えた場合はまとめ通知のみ
		if (existing.count === THROTTLE_THRESHOLD) {
			// スレッショルド到達時にまとめ通知を送信
			await sendThrottledAlert(webhookUrl, key, existing);
			return;
		}
		if (existing.count > THROTTLE_THRESHOLD) {
			// 以降は無音
			return;
		}
	} else {
		alertThrottleMap.set(key, {
			count: 1,
			firstAt: now,
			requestIds: options.requestId ? [options.requestId] : [],
		});
	}

	// 通常のアラート送信
	const isCritical = options.level === 'critical';
	const color = isCritical ? 10038562 : 15548997; // 暗赤 or 赤
	const mention = isCritical ? '@everyone ' : '';

	const fields = [
		options.method && {
			name: 'Endpoint',
			value: `\`${options.method} ${options.path}\``,
			inline: true,
		},
		options.status && { name: 'Status', value: `\`${options.status}\``, inline: true },
		options.requestId && { name: 'RequestId', value: `\`${options.requestId}\``, inline: false },
		options.tenantId && { name: 'TenantId', value: `\`${options.tenantId}\``, inline: true },
		options.errorSummary && {
			name: 'Error',
			value: `\`\`\`${options.errorSummary.slice(0, 500)}\`\`\``,
		},
		options.stackSummary && {
			name: 'Stack (先頭3行)',
			value: `\`\`\`${options.stackSummary.slice(0, 500)}\`\`\``,
		},
	].filter(Boolean);

	const embed = {
		title: `${isCritical ? '🚨' : '🔴'} [${options.level.toUpperCase()}] ${options.message.slice(0, 200)}`,
		color,
		fields,
		timestamp: new Date().toISOString(),
		footer: { text: 'がんばりクエスト system alert' },
	};

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				content: mention || undefined,
				embeds: [embed],
			}),
		});
	} catch (err) {
		logger.warn('[discord-alert] 送信失敗', {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

async function sendThrottledAlert(
	webhookUrl: string,
	key: string,
	entry: { count: number; requestIds: string[] },
): Promise<void> {
	const embed = {
		title: `🔴 [ERROR] 多発検知（5分で${entry.count}件）`,
		description: `同一エラーが繰り返し発生しています。\n\`${key}\``,
		color: 15548997,
		fields: [
			{
				name: 'RequestIds',
				value:
					entry.requestIds
						.slice(0, 5)
						.map((id) => `\`${id}\``)
						.join(', ') || 'N/A',
			},
		],
		timestamp: new Date().toISOString(),
		footer: { text: 'がんばりクエスト system alert (throttled)' },
	};

	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ embeds: [embed] }),
		});
	} catch {
		// silent
	}
}
