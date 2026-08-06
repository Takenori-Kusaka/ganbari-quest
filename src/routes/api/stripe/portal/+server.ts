// POST /api/stripe/portal — Stripe Customer Portal セッション作成
// セキュリティ: 認証必須 + owner/parent ロールのみ + tenantId はサーバー側から取得
// #771: ダウングレード・解約を Stripe Portal に委ねているため、Portal セッション発行前に
//       親 PIN の再確認を要求し、子供による誤操作・誤課金を防ぐ。
//       PIN 未設定テナントは確認フレーズ (`プランを変更します`) でフォールバックする。

import { error, json } from '@sveltejs/kit';
import { SUBSCRIPTION_PAGE_LABELS } from '$lib/domain/labels';
import { logger } from '$lib/server/logger';
import { isPinConfigured, verifyPin } from '$lib/server/services/auth-service';
import { createPortalSession, type PortalFlow } from '$lib/server/services/stripe-service';
import type { RequestHandler } from './$types';

const DOWNGRADE_CONFIRM_PHRASE = 'プランを変更します';

/**
 * 顧客の意図として受け付ける値 (#4270 決裁 3)。
 *
 * `intent` はブラウザから来る文字列であり、いまは flow の出し分けにしか使っていない。
 * 無検証のまま通す形が残っていると、後で認可判定に使う変更が入ったときに同じ書き方が
 * 踏襲される。許容値の allowlist で検証し、外れたら安全側 (home) に倒す。
 */
const PORTAL_INTENTS = ['plan-change', 'plan-upgrade', 'billing-history'] as const;
type PortalIntent = (typeof PORTAL_INTENTS)[number];

/**
 * `intent` を allowlist で解決する。外れた値は既定 (`plan-change` = home) に倒し、拒否を記録する。
 *
 * ログには **顧客識別子を載せない** (#4174 / #4197 と同基準)。値そのものは受け取った文字列なので、
 * ログを壊す長文 / 改行を持ち込めないよう切り詰めて記録する。
 */
function resolvePortalIntent(raw: unknown): PortalIntent {
	if (typeof raw === 'string' && (PORTAL_INTENTS as readonly string[]).includes(raw)) {
		return raw as PortalIntent;
	}
	if (raw !== undefined) {
		const shown = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').slice(0, 32) : typeof raw;
		logger.warn(`[STRIPE] portal intent を拒否しました (許容外の値のため home に倒す): "${shown}"`);
	}
	return 'plan-change';
}

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
		/** #4166: 顧客の意図。portal の着地 (flow) を決める */
		intent?: string;
	};

	const pinConfigured = await isPinConfigured(tenantId);

	if (pinConfigured) {
		// PIN 設定済み: PIN 再入力を必須とする（4〜6桁の数字のみ許容）
		if (!body.pin || typeof body.pin !== 'string' || !/^\d{4,6}$/.test(body.pin)) {
			error(401, 'PIN_REQUIRED');
		}
		const result = await verifyPin(body.pin, tenantId);
		if (!result.ok) {
			// error() は throw する (never) ため各 case を `throw error(...)` で明示終端する。
			// これにより tsc allowUnreachableCode (旧 break が到達不能) と biome
			// noFallthroughSwitchClause (case 終端が必要) の両方を満たす。
			switch (result.error) {
				case 'INVALID_PIN':
					throw error(401, 'INVALID_PIN');
				case 'LOCKED_OUT':
					throw error(423, `LOCKED_OUT:${result.lockedUntil}`);
				case 'PIN_NOT_SET':
					// isPinConfigured と矛盾するが念のため
					throw error(401, 'PIN_NOT_SET');
			}
		}
	} else {
		// PIN 未設定: 確認フレーズでフォールバック
		if (body.confirmPhrase !== DOWNGRADE_CONFIRM_PHRASE) {
			error(401, 'CONFIRM_PHRASE_REQUIRED');
		}
	}

	// #4166: 「⭐ プレミアムへ」だけをプラン変更フローへ直行させる。
	// 汎用の「請求管理ページを開く」(plan-change) と請求履歴 (billing-history) は
	// **home のまま**にする — flow を付けると請求書 / 支払い方法の入口が消えるため (AC5)。
	const intent = resolvePortalIntent(body.intent);
	const flow: PortalFlow =
		intent === 'plan-upgrade' ? { kind: 'subscription_update' } : { kind: 'home' };

	const result = await createPortalSession(tenantId, `${url.origin}/admin/subscription`, flow);

	if ('error' in result) {
		const statusMap: Record<string, number> = {
			STRIPE_DISABLED: 503,
			TENANT_NOT_FOUND: 404,
			NO_STRIPE_CUSTOMER: 400,
			// #4329: Stripe 側の失敗であって顧客のリクエストの誤りではない。
			PORTAL_CREATE_FAILED: 503,
		};
		const messageMap: Record<string, string> = {
			STRIPE_DISABLED: '決済機能は現在利用できません',
			TENANT_NOT_FOUND: 'アカウントが見つかりません',
			NO_STRIPE_CUSTOMER: 'サブスクリプション情報が見つかりません',
			// #4329: 汎用の「エラーが発生しました」に落とすと次に取れる手が伝わらない (ADR-0062)。
			PORTAL_CREATE_FAILED: SUBSCRIPTION_PAGE_LABELS.portalErrorCreateFailed,
		};
		error(statusMap[result.error] ?? 500, messageMap[result.error] ?? 'エラーが発生しました');
	}

	// #4270: flow が Stripe に拒否されて home に倒れた事実をクライアントへ返す。
	// 黙って portal ホームへ飛ばすと「プラン変更画面に行くはずが違う画面に着いた」だけが
	// 顧客に残る。画面側が次の操作を示したうえで進ませる。
	return json({ url: result.url, flowFallback: result.flowFallback === true });
};
