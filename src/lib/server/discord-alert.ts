// src/lib/server/discord-alert.ts
// Discord アラート通知（スロットリング付き）
//
// ## payload に顧客識別子を載せない (#4174 Q3 の PO 決裁 / #4192)
//
// Discord は外部 SaaS で embed はチャットログとして永続化される。したがって本 alert は
// **「何が起きたか」だけを送り、「誰に起きたか」は送らない**。旧実装が持っていた `tenantId`
// field は撤去済で、型からも消してある (callsite が渡せない = コンパイルで落ちる)。
//
// **調査の導線は失っていない**: 各 callsite は同じ内容を `logger.error` / `logger.warn` に
// tenantId 付きで出しており、alert に載る `requestId` から CloudWatch Logs で引ける。
// redaction の実装は `$lib/server/notify-privacy` に単一化してある (callsite 依存にしない)。

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';
import { redactNotificationText, redactPathIds } from '$lib/server/notify-privacy';

export interface AlertOptions {
	level: 'error' | 'critical';
	message: string;
	method?: string;
	path?: string;
	status?: number;
	/**
	 * ログを引くための鍵。**顧客識別子ではない**ため載せてよい (#4174 Q3)。
	 * 「どの家族か」はこの id で CloudWatch Logs / DB を引く。
	 */
	requestId?: string;
	errorSummary?: string;
	stackSummary?: string;
	/**
	 * triage に必要な補足情報 (event id / 件数など) を 1 行で表したもの。
	 *
	 * `message` は embed title に展開される際 200 文字で切られ、`errorSummary` は
	 * スロットリング key を兼ねるため実行ごとに変わる値を入れられない。両方に載せられない
	 * 「毎回変わるが受け手が必要とする情報」の置き場としてこの field を使う (#4102 / #3959)。
	 * スロットリング key には含めない (同一事象は変わらず 1 通にまとまる)。
	 */
	details?: string;
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

/**
 * 送出前に顧客識別子を落とす (#4174 Q3 / #4192)。
 *
 * **入口で 1 回だけ通す**のが要点。ここを通した後の `options` しか embed にもスロットリング key にも
 * 使わないため、callsite が何を渡しても Discord には顧客識別子が出ない。
 */
export function redactAlertOptions(options: AlertOptions): AlertOptions {
	return {
		...options,
		message: redactNotificationText(options.message) ?? options.message,
		path: redactPathIds(options.path),
		errorSummary: redactNotificationText(options.errorSummary),
		details: redactNotificationText(options.details),
		stackSummary: redactNotificationText(options.stackSummary),
	};
}

/**
 * alert embed を組み立てる (redaction 済 options を受ける)。
 *
 * **送出と分けてある理由**: 「顧客識別子が出力に現れない」ことを unit test で固定するため
 * (#4192 AC4)。fetch を張らずに payload そのものを検査できる。
 */
export function buildAlertEmbed(options: AlertOptions): Record<string, unknown> {
	const isCritical = options.level === 'critical';
	const fields = [
		options.method && {
			name: 'Endpoint',
			value: `\`${options.method} ${options.path}\``,
			inline: true,
		},
		options.status && { name: 'Status', value: `\`${options.status}\``, inline: true },
		options.requestId && { name: 'RequestId', value: `\`${options.requestId}\``, inline: false },
		options.errorSummary && {
			name: 'Error',
			value: `\`\`\`${options.errorSummary.slice(0, 500)}\`\`\``,
		},
		options.details && {
			name: 'Details',
			// Discord の embed field value 上限は 1024 文字。code block の記号分を引いて余裕を取る
			value: `\`\`\`${options.details.slice(0, 900)}\`\`\``,
		},
		options.stackSummary && {
			name: 'Stack (先頭3行)',
			value: `\`\`\`${options.stackSummary.slice(0, 500)}\`\`\``,
		},
	].filter(Boolean);

	return {
		title: `${isCritical ? '🚨' : '🔴'} [${options.level.toUpperCase()}] ${options.message.slice(0, 200)}`,
		color: isCritical ? 10038562 : 15548997, // 暗赤 or 赤
		fields,
		timestamp: new Date().toISOString(),
		footer: { text: 'がんばりクエスト system alert' },
	};
}

export async function sendDiscordAlert(rawOptions: AlertOptions): Promise<void> {
	const webhookUrl = getAlertWebhookUrl();
	if (!webhookUrl) return;

	// #4174 Q3: 以降は redact 済 options だけを使う (embed / throttle key の両方)
	const options = redactAlertOptions(rawOptions);

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
	const mention = options.level === 'critical' ? '@everyone ' : '';
	const embed = buildAlertEmbed(options);

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

/**
 * まとめ通知の embed を組み立てる。
 *
 * `key` は redact 済 options から作られている (`sendDiscordAlert` 入口で `redactAlertOptions` を
 * 通しているため) ので、description に載せても顧客識別子は出ない (#4174 Q3)。
 */
export function buildThrottledAlertEmbed(
	key: string,
	entry: { count: number; requestIds: string[] },
): Record<string, unknown> {
	return {
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
}

async function sendThrottledAlert(
	webhookUrl: string,
	key: string,
	entry: { count: number; requestIds: string[] },
): Promise<void> {
	try {
		await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ embeds: [buildThrottledAlertEmbed(key, entry)] }),
		});
	} catch {
		// silent
	}
}
