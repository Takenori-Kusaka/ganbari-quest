// src/lib/server/services/founder-inquiry-service.ts
// #1594 ADR-0023 I8: founder 1:1 ヒアリング動線
//
// LP / admin の「直接相談」CTA から送信される問い合わせを受け取り、
// Discord webhook ('inquiry' チャネル) に founder 宛通知を送る。
//
// Pre-PMF "do things that don't scale" 実践のため、初期 ~10 親契約まで
// founder が一人ひとりに直接返信する想定。本 service は通知のみ担当し、
// SES 等の二重保管は YAGNI の観点で導入しない（必要になった時点で追加）。

import { notifyDiscord } from '$lib/server/services/discord-notify-service';

export const FOUNDER_INQUIRY_LIMITS = {
	NAME_MAX: 100,
	EMAIL_MAX: 200,
	CHILD_AGE_MAX: 50,
	MESSAGE_MAX: 2000,
	/** Discord embed の description 上限 (4096) を考慮した安全側の値 */
	MESSAGE_DISCORD_TRUNCATE: 1900,
} as const;

export interface FounderInquiryInput {
	name: string;
	email: string;
	childAge?: string;
	message: string;
	/** 送信元ページパス (admin から送信した場合の文脈情報) */
	sourcePath?: string;
	/** 認証済みテナントの場合に紐付け */
	tenantId?: string;
}

export interface FounderInquiryValidationError {
	field: 'name' | 'email' | 'message' | 'childAge';
	message: string;
}

export type FounderInquiryValidationResult =
	| { ok: true; value: FounderInquiryInput }
	| { ok: false; errors: FounderInquiryValidationError[] };

/** RFC 5322 ベースの簡易メール検証 (login flow と同じ寛容な regex) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateFounderInquiry(raw: unknown): FounderInquiryValidationResult {
	const errors: FounderInquiryValidationError[] = [];
	const r = (raw ?? {}) as Record<string, unknown>;

	const name = typeof r.name === 'string' ? r.name.trim() : '';
	const email = typeof r.email === 'string' ? r.email.trim() : '';
	const childAge = typeof r.childAge === 'string' ? r.childAge.trim() : '';
	const message = typeof r.message === 'string' ? r.message.trim() : '';
	const sourcePath = typeof r.sourcePath === 'string' ? r.sourcePath.trim() : '';
	const tenantId = typeof r.tenantId === 'string' ? r.tenantId.trim() : '';

	if (!name) errors.push({ field: 'name', message: 'お名前は必須です' });
	if (name.length > FOUNDER_INQUIRY_LIMITS.NAME_MAX) {
		errors.push({
			field: 'name',
			message: `お名前は ${FOUNDER_INQUIRY_LIMITS.NAME_MAX} 文字以内にしてください`,
		});
	}

	if (!email) {
		errors.push({ field: 'email', message: 'メールアドレスは必須です' });
	} else if (email.length > FOUNDER_INQUIRY_LIMITS.EMAIL_MAX) {
		errors.push({
			field: 'email',
			message: `メールアドレスは ${FOUNDER_INQUIRY_LIMITS.EMAIL_MAX} 文字以内にしてください`,
		});
	} else if (!EMAIL_REGEX.test(email)) {
		errors.push({ field: 'email', message: 'メールアドレスの形式が正しくありません' });
	}

	if (childAge.length > FOUNDER_INQUIRY_LIMITS.CHILD_AGE_MAX) {
		errors.push({
			field: 'childAge',
			message: `お子さまの年齢は ${FOUNDER_INQUIRY_LIMITS.CHILD_AGE_MAX} 文字以内にしてください`,
		});
	}

	if (!message) {
		errors.push({ field: 'message', message: 'ご相談内容は必須です' });
	} else if (message.length > FOUNDER_INQUIRY_LIMITS.MESSAGE_MAX) {
		errors.push({
			field: 'message',
			message: `ご相談内容は ${FOUNDER_INQUIRY_LIMITS.MESSAGE_MAX} 文字以内にしてください`,
		});
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		value: {
			name,
			email,
			...(childAge ? { childAge } : {}),
			message,
			...(sourcePath ? { sourcePath } : {}),
			...(tenantId ? { tenantId } : {}),
		},
	};
}

/**
 * Discord 'inquiry' チャネルへ founder 宛通知を送信する。
 * 通知失敗してもユーザー側にはエラーを伝播しない (notifyDiscord 内で吸収済み)。
 */
export async function notifyFounderInquiry(input: FounderInquiryInput): Promise<void> {
	const truncatedMessage =
		input.message.length > FOUNDER_INQUIRY_LIMITS.MESSAGE_DISCORD_TRUNCATE
			? `${input.message.slice(0, FOUNDER_INQUIRY_LIMITS.MESSAGE_DISCORD_TRUNCATE)}…(以下省略)`
			: input.message;

	await notifyDiscord('inquiry', {
		title: '👋 founder 直接相談（受付）',
		description: truncatedMessage,
		// founder 直接相談用に通常の inquiry と区別できる紫色
		color: 0x9b59b6,
		fields: [
			{ name: 'お名前', value: input.name, inline: true },
			{ name: '返信先メール', value: input.email, inline: true },
			...(input.childAge ? [{ name: 'お子さま年齢', value: input.childAge, inline: true }] : []),
			...(input.tenantId ? [{ name: 'テナント ID', value: input.tenantId, inline: true }] : []),
			...(input.sourcePath ? [{ name: '送信元', value: input.sourcePath, inline: false }] : []),
		],
		footer: { text: '#1594 ADR-0023 I8 / founder 1:1 hearing' },
	});
}
