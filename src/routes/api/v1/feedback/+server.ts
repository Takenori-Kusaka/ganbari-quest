// src/routes/api/v1/feedback/+server.ts
// #839: アプリ内フィードバック送信 API
// Discord webhook (inquiry チャネル) に転送する

import { error, json } from '@sveltejs/kit';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';
import type { RequestHandler } from './$types';

const CATEGORY_VALUES = ['opinion', 'bug', 'feature', 'other'] as const;
const MAX_TEXT_LENGTH = 1000;

// 簡易レート制限: tenantId → 最終送信時刻
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5分

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	const tenantId = context?.tenantId ?? 'anonymous';
	const identity = locals.identity;
	const email = identity?.type === 'cognito' ? identity.email : 'local-user';

	// レート制限チェック
	const lastSent = rateLimitMap.get(tenantId);
	if (lastSent && Date.now() - lastSent < RATE_LIMIT_MS) {
		const remainSec = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSent)) / 1000);
		throw error(429, {
			message: `送信間隔が短すぎます。${remainSec}秒後にお試しください`,
		});
	}

	const body = await request.json();
	const category = String(body.category ?? '').trim();
	const text = String(body.text ?? '').trim();
	const currentUrl = String(body.currentUrl ?? '').trim();

	// バリデーション
	if (!CATEGORY_VALUES.includes(category as (typeof CATEGORY_VALUES)[number])) {
		throw error(400, { message: '種別を選択してください' });
	}
	if (!text) {
		throw error(400, { message: '内容を入力してください' });
	}
	if (text.length > MAX_TEXT_LENGTH) {
		throw error(400, { message: `内容は${MAX_TEXT_LENGTH}文字以内にしてください` });
	}

	// Discord に送信
	const categoryLabel: Record<string, string> = {
		opinion: '💭 ご意見',
		bug: '🐛 不具合報告',
		feature: '✨ 機能要望',
		other: '📝 その他',
	};

	await notifyInquiry(
		tenantId,
		category,
		`${categoryLabel[category] ?? category}\n\n${text}${currentUrl ? `\n\n📍 送信元: ${currentUrl}` : ''}`,
		email,
	);

	// レート制限記録
	rateLimitMap.set(tenantId, Date.now());

	return json({ success: true });
};
