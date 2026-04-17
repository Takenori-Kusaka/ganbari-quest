// POST /api/stripe/portal — Stripe Customer Portal セッション作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得
// #771: ダウングレード・解約を Stripe Portal に委ねているため、Portal セッション発行前に
//       親 PIN の再確認を要求し、子供による誤操作・誤課金を防ぐ。
//       PIN 未設定テナントは確認フレーズ (`プランを変更します`) でフォールバックする。

import { error, json } from '@sveltejs/kit';
import { isPinConfigured, verifyPin } from '$lib/server/services/auth-service';
import { createPortalSession } from '$lib/server/services/stripe-service';
import type { RequestHandler } from './$types';

const DOWNGRADE_CONFIRM_PHRASE = 'プランを変更します';

export const POST: RequestHandler = async ({ locals, url, request }) => {
	const context = locals.context;
	if (!context) {
		error(401, '認証が必要です');
	}
	const tenantId = context.tenantId;

	const role = locals.context?.role;
	if (role !== 'owner' && role !== 'parent') {
		error(403, 'サブスクリプションの管理は保護者のみ可能です');
	}

	// #771: ダウングレード前の二段階確認
	const body = (await request.json().catch(() => ({}))) as {
		pin?: string;
		confirmPhrase?: string;
	};

	const pinConfigured = await isPinConfigured(tenantId);

	if (pinConfigured) {
		// PIN 設定済み: PIN 再入力を必須とする（4〜6桁の数字のみ許容）
		if (!body.pin || typeof body.pin !== 'string' || !/^\d{4,6}$/.test(body.pin)) {
			error(401, 'PIN_REQUIRED');
		}
		const result = await verifyPin(body.pin, tenantId);
		if (!result.ok) {
			switch (result.error) {
				case 'INVALID_PIN':
					error(401, 'INVALID_PIN');
					break;
				case 'LOCKED_OUT':
					error(423, `LOCKED_OUT:${result.lockedUntil}`);
					break;
				case 'PIN_NOT_SET':
					// isPinConfigured と矛盾するが念のため
					error(401, 'PIN_NOT_SET');
					break;
			}
		}
	} else {
		// PIN 未設定: 確認フレーズでフォールバック
		if (body.confirmPhrase !== DOWNGRADE_CONFIRM_PHRASE) {
			error(401, 'CONFIRM_PHRASE_REQUIRED');
		}
	}

	const result = await createPortalSession(tenantId, `${url.origin}/admin/license`);

	if ('error' in result) {
		const statusMap: Record<string, number> = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			NO_STRIPE_CUSTOMER: 400,
		};
		const messageMap: Record<string, string> = {
			STRIPE_DISABLED: '決済機能は現在利用できません',
			TENANT_NOT_FOUND: 'アカウントが見つかりません',
			NO_STRIPE_CUSTOMER: 'サブスクリプション情報が見つかりません',
		};
		error(statusMap[result.error] ?? 500, messageMap[result.error] ?? 'エラーが発生しました');
	}

	return json({ url: result.url });
};
