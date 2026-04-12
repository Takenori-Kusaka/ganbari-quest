// src/routes/api/v1/feedback/+server.ts
// #839: アプリ内フィードバック送信 API
// Discord webhook (inquiry チャネル) に転送する

import { error, json } from '@sveltejs/kit';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';
import type { RequestHandler } from './$types';

const CATEGORY_VALUES = ['opinion', 'bug', 'feature', 'other'] as const;
const MAX_TEXT_LENGTH = 1000;
/** スクリーンショット dataURL の最大サイズ (2MB) */
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

// ============================================================
// 簡易レート制限（インメモリ Map）
// ============================================================
//
// NOTE: Lambda 環境ではインスタンス間で Map が共有されないため、
// 厳密なレート制限にはならない。厳密な制限が必要な場合は
// DynamoDB ベースに移行すること。
//
// メモリリーク防止:
// - エントリに timestamp を保持し、TTL (RATE_LIMIT_MS) 経過分を自動削除
// - Map サイズ上限 (MAX_MAP_SIZE) を超過した場合、古いエントリから削除

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5分
const MAX_MAP_SIZE = 1000;

const rateLimitMap = new Map<string, number>();

/** TTL 超過エントリを削除し、サイズ上限を適用する */
function cleanupRateLimitMap(): void {
	const now = Date.now();
	// TTL 超過エントリを削除
	for (const [key, timestamp] of rateLimitMap) {
		if (now - timestamp >= RATE_LIMIT_MS) {
			rateLimitMap.delete(key);
		}
	}
	// サイズ上限超過時は古いエントリから削除
	if (rateLimitMap.size > MAX_MAP_SIZE) {
		const entries = [...rateLimitMap.entries()].sort((a, b) => a[1] - b[1]);
		const deleteCount = rateLimitMap.size - MAX_MAP_SIZE;
		for (let i = 0; i < deleteCount; i++) {
			const entry = entries[i];
			if (entry) rateLimitMap.delete(entry[0]);
		}
	}
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	const tenantId = context?.tenantId ?? 'anonymous';
	const identity = locals.identity;
	const email = identity?.type === 'cognito' ? identity.email : 'local-user';

	// レート制限チェック（チェック前にクリーンアップ）
	cleanupRateLimitMap();
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
	const screenshot = body.screenshot != null ? String(body.screenshot) : '';

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
	// スクリーンショットサイズ検証
	if (screenshot && screenshot.length > MAX_SCREENSHOT_BYTES) {
		throw error(400, { message: 'スクリーンショットは2MB以内にしてください' });
	}

	// Discord に送信
	const categoryLabel: Record<string, string> = {
		opinion: '💭 ご意見',
		bug: '🐛 不具合報告',
		feature: '✨ 機能要望',
		other: '📝 その他',
	};

	const screenshotNote = screenshot ? '\n📎 スクリーンショット添付あり' : '';

	await notifyInquiry(
		tenantId,
		category,
		`${categoryLabel[category] ?? category}\n\n${text}${currentUrl ? `\n\n📍 送信元: ${currentUrl}` : ''}${screenshotNote}`,
		email,
	);

	// レート制限記録
	rateLimitMap.set(tenantId, Date.now());

	return json({ success: true });
};
