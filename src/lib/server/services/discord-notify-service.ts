// src/lib/server/services/discord-notify-service.ts
// 運用者向け Discord Webhook 通知サービス
//
// ## 持っているチャネルは 2 つだけ (#4174 Q2 の PO 決裁 / #4192)
//
// `signup` / `billing` / `churn` は **持たないと決めた**。未実装でも「secret を登録すれば動く」
// でもなく、**送らないことを選んだ**チャネルである。
//
//   通知は「人が行動を変えるもの」だけを送る。サインアップは嬉しいが何もしない。課金の成功も
//   同じ。解約理由は `cancellation_reasons` に残るので通知で見ても何もできない。
//   **通知が増えると incident が埋もれる** — 見ても行動しない通知は、見るべき通知の価値を下げる
//   (ADR-0012 anti-engagement の運用者版)。
//
// したがって「取りこぼしている情報がある」ように見えても、チャネルを足して塞ぐのは誤り。
// 復活させたい場合は **決裁をやり直す**こと。再配線は
// `tests/unit/architecture/notification-channels-not-owned.test.ts` が CI で落とす。
//
// ## payload に顧客識別子を載せない (#4174 Q3 の PO 決裁 / #4192)
//
// Discord は運用者の機器ではなく外部 SaaS で、embed はチャットログとして永続化される。
// 通知は「起きた」を伝えるのが役割で、「誰に起きた」は認証された場所 (ログ / DB) で引く。
// 送出直前の redaction は `$lib/server/notify-privacy` に単一化してある。

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logger';
import { redactNotificationText, redactPathIds } from '$lib/server/notify-privacy';

type DiscordChannel = 'inquiry' | 'incident';

export interface DiscordEmbed {
	title: string;
	description?: string;
	color: number;
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
	timestamp?: string;
	footer?: { text: string };
}

const WEBHOOK_ENV_MAP: Record<DiscordChannel, string> = {
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

/**
 * #3211: ユーザー自由記述を Discord embed に載せる前の sanitization。
 *
 * ping の構造的無効化は notifyDiscord の `allowed_mentions:{parse:[]}` (Discord 公式機構、#3388) が
 * 担う。本関数は **mention 構文の視認ノイズ低減 + 二重防御** のための補助的中和であり、
 * 自由記述本文 (text) にのみ適用する。PII (childAge 等) は本関数では redaction されない
 * (平文のまま送信される)。実 PII redaction/retention は別途 #3211 item1b の領域。
 *
 * - `@everyone` / `@here` は `@` 直後に zero-width space (U+200B) を挿入して mention 文字列を壊す
 * - `<@123>` / `<@!123>` / `<@&123>` (user/role) / `<#123>` (channel) mention は `<` 直後に同様
 *
 * 文字は削除せず可視内容は保持する。email 等の正当な `@here`/`@everyone` 部分文字列を含む値
 * (`foo@here.com`) には適用しない (zero-width space 混入でコピペが壊れるため、#3388)。
 */
export function sanitizeDiscordText(text: string): string {
	return text.replace(/@(everyone|here)/gi, '@​$1').replace(/<(@!?&?|#)(\d+)>/g, '<​$1$2>');
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
				// #3388: allowed_mentions parse:[] で全 channel/field の @everyone/@here/role/user
				// mention の ping を Discord 公式機構で構造的に無効化する (単一点防御)。これにより
				// embed 内のユーザー自由記述が ping を発火させない。表示はそのまま (無害)、ping のみ抑止。
				allowed_mentions: { parse: [] },
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

/**
 * incident embed を組み立てる (顧客識別子を落とした後の payload)。
 *
 * **送出と分けてある理由**: 「顧客識別子が出力に現れない」ことを unit test で固定するため
 * (#4192 AC4)。fetch を張らずに payload そのものを検査できる。
 */
export function buildIncidentEmbed(
	errorMessage: string,
	context: { method?: string; path?: string; status?: number },
): DiscordEmbed {
	// #4174 Q3: error message には顧客データ (email / 内部 id) が混ざりうる。path には childId 等の
	// 可変セグメントが載る。どちらも送出前に落とす (単一強制点は notify-privacy.ts)。
	const description = redactNotificationText(errorMessage.slice(0, 1000));
	const path = redactPathIds(context.path);
	return {
		title: '🚨 システムエラー',
		color: 0xe74c3c, // red
		...(description ? { description } : {}),
		fields: [
			...(context.method ? [{ name: 'メソッド', value: context.method, inline: true }] : []),
			...(path ? [{ name: 'パス', value: path, inline: true }] : []),
			...(context.status
				? [{ name: 'ステータス', value: String(context.status), inline: true }]
				: []),
		],
	};
}

/** システム障害通知 */
export async function notifyIncident(
	errorMessage: string,
	context: { method?: string; path?: string; status?: number },
): Promise<void> {
	await notifyDiscord('incident', buildIncidentEmbed(errorMessage, context));
}

const INQUIRY_CATEGORY_LABELS: Record<string, string> = {
	feature: '機能要望',
	bug: 'バグ報告',
	opinion: 'ご意見',
	consult: '相談・困りごと',
	other: 'その他',
};

/**
 * inquiry embed を組み立てる (顧客識別子を落とした後の payload)。
 *
 * **送出と分けてある理由**: buildIncidentEmbed と同じ — 「顧客識別子が出力に現れない」ことを
 * unit test で固定するため (#4197 / #4192 AC4)。fetch を張らずに payload そのものを検査できる。
 *
 * ## 何を載せ、何を載せないか (#4174 Q3 の PO 決裁 / #4197)
 *
 * - **載せる**: 受付番号 (inquiryId)・カテゴリ・本文
 * - **載せない**: tenantId / 送信者メールアドレス / 返信先メールアドレス
 *
 * 「返信先アドレスが目的そのもの」は載せてよい理由にならない。**返信する場所は Discord ではない**。
 * 送信者 / 返信先 / テナントは受付番号を鍵に `inquiries` 表 (認証された場所) から引く。
 *
 * ## 本文を載せる判断 (#4197 AC3)
 *
 * 本文は**載せる**。載せない選択が可能なのは「運用者が本文を読める認証済画面が実在する」場合だが、
 * 現状 `IInquiryRepo` は `generateInquiryId` / `saveInquiry` のみで**読み出し API を持たず**、
 * `/ops` 配下にも inquiry を開く画面が無い。本文まで落とすと問い合わせ対応が止まるため、
 * 本文は redaction を通したうえで残す。自由記述に混ざる email / UUID / path 中の id は
 * `redactNotificationText` (単一強制点) が落とす。
 *
 * 順序は **redact → sanitize** で固定する。逆順だと `sanitizeDiscordText` が `foo@here.com` の
 * `@here` に zero-width space を挿してメールアドレスの形を壊し、redaction をすり抜ける。
 */
export function buildInquiryEmbed(
	category: string,
	text: string,
	inquiryId?: string,
): DiscordEmbed {
	const categoryLabel = INQUIRY_CATEGORY_LABELS[category] ?? category;
	const redacted = redactNotificationText(text.slice(0, 2000)) ?? '';
	return {
		title: `📬 ${categoryLabel}${inquiryId ? ` (${inquiryId})` : ''}`,
		// #3388: ping の構造的無効化は notifyDiscord の allowed_mentions:{parse:[]} が担う (単一点防御)。
		// ここでの中和は表示ノイズ低減の二重防御。
		description: sanitizeDiscordText(redacted),
		color: category === 'bug' ? 0xff4444 : 0x4a90d9,
		fields: [
			...(inquiryId ? [{ name: '受付番号', value: inquiryId, inline: true }] : []),
			{ name: 'カテゴリ', value: categoryLabel, inline: true },
			{
				name: '送信者を見る',
				value: inquiryId
					? `認証された場所で引く: \`inquiries\` 表を inquiry_id=\`${inquiryId}\` で照会 (送信者 / 返信先 / テナントはそこにある)`
					: '認証された場所で引く: `inquiries` 表を送信時刻で照会 (受付番号の採番前に失敗した通知)',
			},
		],
	};
}

/** お問い合わせ通知 */
export async function notifyInquiry(
	category: string,
	text: string,
	inquiryId?: string,
): Promise<void> {
	await notifyDiscord('inquiry', buildInquiryEmbed(category, text, inquiryId));
}
