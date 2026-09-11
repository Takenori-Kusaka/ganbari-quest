// src/lib/server/api/suggest-plan-gate.ts
// AI 提案エンドポイント共通プランゲート (#727)

import { error } from '@sveltejs/kit';
import { isAiSuggestUnlocked } from '$lib/domain/ai-suggest-gate';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { planLimitError } from '$lib/server/errors';
import { resolveFullPlanTier } from '$lib/server/services/plan-limit-service';

interface PlanGateSuccess {
	ok: true;
	tenantId: string;
	text: string;
}

interface PlanGateFailure {
	ok: false;
	response: Response;
}

/**
 * AI 提案エンドポイント共通のプランゲートとバリデーションを実行する。
 *
 * 1. 認証チェック（未認証 → 401）
 * 2. **role チェック（child → 403）**
 * 3. プランチェック（family 以外 → PLAN_LIMIT_EXCEEDED）
 * 4. テキストバリデーション（空 → 400, 200文字超 → 400）
 *
 * ## role チェックをここに置く理由 (#4866 系 QM 監査 / PO 差し戻し 2026-09-09)
 *
 * `authorization.ts` の `ROUTE_RULES` は `/api/v1` を `['owner','parent','child']` に開けており、
 * **child セッションは AI 提案 4 経路に到達できる**。AI 提案は親が活動・ごほうび・
 * チェックリストを**設計する**ための機能で (呼び出し元はすべて admin 画面)、
 * かつ **LLM を叩く = 顧客の金 (ベンダーコスト) が動く**。子供が叩ける状態にしておく
 * 理由が無い。
 *
 * 4 route それぞれに書くのではなく**この共通関数 1 箇所**に置くのは、
 * 新しい suggest route を追加した人が自動で同じ gate を通るようにするため。
 * 判定はルート横断の唯一の seam (`requireRole`) 経由にする (#3528 /
 * 14-セキュリティ設計書 §5.2.3 §5.2.5)。
 *
 * @returns 成功時は { ok: true, tenantId, text }, 失敗時は { ok: false, response }
 */
export async function validateSuggestRequest(
	locals: App.Locals,
	request: Request,
	featureLabel: string,
): Promise<PlanGateSuccess | PlanGateFailure> {
	if (!locals.context) {
		throw error(401, { message: 'Unauthorized' });
	}
	// AI 提案は親が設計するための機能で、LLM の呼び出しは顧客の金に直結する。
	// plan gate より**前**に置く — 権限の無い要求のために課金状態を引きに行かない
	// (`special-rewards/[childId]` が `requireChildAccess` を plan 解決より前に置いているのと同じ理由)。
	const roleGate = parentGateResponse(locals);
	if (roleGate) return { ok: false, response: roleGate };

	const tenantId = locals.context.tenantId;

	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const tier = await resolveFullPlanTier(tenantId, licenseStatus, locals.context?.plan);
	// #4506: UI 側のロック表示と同一述語 ($lib/domain/ai-suggest-gate) を使う。
	// enforcement と表示が別式だったために「表示の嘘」が 3 画面で発生した。
	if (!isAiSuggestUnlocked(tier)) {
		return {
			ok: false,
			// #4710: AI 提案は premium 限定。standard 契約者に「スタンダード以上に」と言わない。
			// #4767 PO 回答 #4: 顧客に届く文言は errors.ts が機能名 + tier + 導線で 1 本に組み立てる
			response: planLimitError('family', featureLabel),
		};
	}

	const body = await request.json();
	const text = String(body.text ?? '').trim();

	if (!text) {
		throw error(400, { message: 'テキストを入力してください' });
	}

	if (text.length > 200) {
		throw error(400, { message: 'テキストは200文字以内にしてください' });
	}

	return { ok: true, tenantId, text };
}
