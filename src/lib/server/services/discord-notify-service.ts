// src/lib/server/services/discord-notify-service.ts
// 運用者向け Discord Webhook 通知サービス

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';

type DiscordChannel = 'signup' | 'billing' | 'churn' | 'inquiry' | 'incident';

interface DiscordEmbed {
	title: string;
	description?: string;
	color: number;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
	timestamp?: string;
	footer?: { text: string };
}

const WEBHOOK_ENV_MAP: Record<DiscordChannel, string> = {
	signup: 'DISCORD_WEBHOOK_SIGNUP',
	billing: 'DISCORD_WEBHOOK_BILLING',
	churn: 'DISCORD_WEBHOOK_CHURN',
	inquiry: 'DISCORD_WEBHOOK_INQUIRY',
	incident: 'DISCORD_WEBHOOK_INCIDENT',
};

// レガシー互換: FEEDBACK_DISCORD_WEBHOOK_URL → inquiry
function getWebhookUrl(channel: DiscordChannel): string | undefined {
	const primary = env[WEBHOOK_ENV_MAP[channel]];
	if (primary) return primary;
	if (channel === 'inquiry') return env.FEEDBACK_DISCORD_WEBHOOK_URL;
	return undefined;
}

/** Discord Webhook にメッセージを送信（失敗してもエラーを投げない） */
export async function notifyDiscord(channel: DiscordChannel, embed: DiscordEmbed): Promise<void> {
	const webhookUrl = getWebhookUrl(channel);
	if (!webhookUrl) return;

	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				embeds: [{ ...embed, timestamp: embed.timestamp ?? new Date().toISOString() }],
			}),
		});

		if (!response.ok) {
			logger.warn(`[discord-notify] Webhook returned ${response.status} for channel=${channel}`);
		}
	} catch (err) {
		logger.error(`[discord-notify] Webhook failed for channel=${channel}`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}
}

// ============================================================
// 便利関数
// ============================================================

/** 新規テナント作成通知 */
export async function notifyNewSignup(tenantId: string, email: string): Promise<void> {
	await notifyDiscord('signup', {
		title: '🆕 新規登録',
		color: 0x2ecc71, // green
		fields: [
			{ name: 'テナントID', value: tenantId, inline: true },
			{ name: 'メール', value: email, inline: true },
			{ name: '登録日時', value: formatJST(new Date()), inline: true },
		],
	});
}

/** 課金イベント通知 */
export async function notifyBillingEvent(
	tenantId: string,
	event: string,
	details?: string,
): Promise<void> {
	const colors: Record<string, number> = {
		checkout_completed: 0x3498db, // blue
		invoice_paid: 0x2ecc71, // green
		payment_failed: 0xe74c3c, // red
		subscription_updated: 0xf39c12, // yellow
		subscription_deleted: 0xe74c3c, // red
	};

	const labels: Record<string, string> = {
		checkout_completed: '💳 課金開始',
		invoice_paid: '✅ 支払い完了',
		payment_failed: '❌ 支払い失敗',
		subscription_updated: '🔄 プラン変更',
		subscription_deleted: '🚫 サブスクリプション解約',
	};

	await notifyDiscord('billing', {
		title: labels[event] ?? `💳 ${event}`,
		color: colors[event] ?? 0x95a5a6,
		fields: [
			{ name: 'テナントID', value: tenantId, inline: true },
			{ name: 'イベント', value: event, inline: true },
			...(details ? [{ name: '詳細', value: details, inline: false }] : []),
		],
	});
}

/** 退会申請通知 */
export async function notifyCancellation(tenantId: string, graceEndDate: string): Promise<void> {
	await notifyDiscord('churn', {
		title: '⚠️ 退会申請',
		color: 0xe67e22, // orange
		fields: [
			{ name: 'テナントID', value: tenantId, inline: true },
			{ name: '猶予期間終了', value: graceEndDate, inline: true },
		],
	});
}

/** 退会キャンセル通知 */
export async function notifyCancellationReverted(tenantId: string): Promise<void> {
	await notifyDiscord('churn', {
		title: '↩️ 退会キャンセル',
		color: 0x2ecc71, // green
		fields: [{ name: 'テナントID', value: tenantId, inline: true }],
	});
}

/** データ削除完了通知 */
export async function notifyDeletionComplete(
	tenantId: string,
	stats: { items: number; files: number },
): Promise<void> {
	await notifyDiscord('churn', {
		title: '🗑️ データ削除完了',
		color: 0x95a5a6, // gray
		fields: [
			{ name: 'テナントID', value: tenantId, inline: true },
			{ name: '削除アイテム数', value: String(stats.items), inline: true },
			{ name: '削除ファイル数', value: String(stats.files), inline: true },
		],
	});
}

/** システム障害通知 */
export async function notifyIncident(
	errorMessage: string,
	context: { method?: string; path?: string; status?: number },
): Promise<void> {
	await notifyDiscord('incident', {
		title: '🚨 システムエラー',
		color: 0xe74c3c, // red
		description: errorMessage.slice(0, 1000),
		fields: [
			...(context.method ? [{ name: 'メソッド', value: context.method, inline: true }] : []),
			...(context.path ? [{ name: 'パス', value: context.path, inline: true }] : []),
			...(context.status
				? [{ name: 'ステータス', value: String(context.status), inline: true }]
				: []),
		],
	});
}

/** お問い合わせ通知 */
// biome-ignore lint/complexity/useMaxParams: 型安全のため引数を個別定義、別 Issue でオブジェクト引数化予定
export async function notifyInquiry(
	tenantId: string,
	category: string,
	text: string,
	email: string,
	replyEmail?: string,
	inquiryId?: string,
): Promise<void> {
	const categoryLabel: Record<string, string> = {
		feature: '機能要望',
		bug: 'バグ報告',
		other: 'その他',
	};

	await notifyDiscord('inquiry', {
		title: `📬 ${categoryLabel[category] ?? category}${inquiryId ? ` (${inquiryId})` : ''}`,
		description: text.slice(0, 2000),
		color: category === 'bug' ? 0xff4444 : 0x4a90d9,
		fields: [
			...(inquiryId ? [{ name: '受付番号', value: inquiryId, inline: true }] : []),
			{ name: 'テナント', value: tenantId, inline: true },
			{ name: '送信者', value: email, inline: true },
			{ name: '返信先', value: replyEmail || 'なし', inline: true },
		],
	});
}

/** Date を JST 文字列に変換 */
function formatJST(date: Date): string {
	return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}
