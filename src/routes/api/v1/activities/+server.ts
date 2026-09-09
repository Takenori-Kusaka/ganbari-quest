import { json } from '@sveltejs/kit';
import * as v from 'valibot';
// #3740: client-facing 経路の wire source は信頼せず正準 'custom' を強制する (trust 境界分離)
import { PARENT_CREATED_SOURCE } from '$lib/domain/activity-source';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { PLAN_GATE_LABELS } from '$lib/domain/labels';
import { activitiesQuerySchema, createActivitySchema } from '$lib/domain/validation/activity';
import { requireChildAccess } from '$lib/server/auth/factory';
import { parentGateResponse } from '$lib/server/auth/owner-gate';
import { findChildById } from '$lib/server/db/activity-repo';
import { quotaLimitError, validationError } from '$lib/server/errors';
import { createActivity, getActivities } from '$lib/server/services/activity-service';
import { checkActivityLimit } from '$lib/server/services/plan-limit-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	const parsed = v.safeParse(activitiesQuerySchema, Object.fromEntries(url.searchParams));
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? 'パラメータが不正です');
	}

	let childAge: number | undefined;
	if (parsed.output.childId) {
		// `?childId=` は年齢での出し分けにしか使わないが、child ロールが兄弟の childId を
		// 指定して「兄弟の年齢で絞った一覧」を引けるのは per-child scope の逸脱なので塞ぐ。
		// childId 省略時 (家族全体の一覧) は従来どおり全ロールに開く。
		requireChildAccess(locals, parsed.output.childId);
		const child = await findChildById(parsed.output.childId, tenantId);
		if (child) childAge = child.age;
	}

	const result = await getActivities(tenantId, {
		childAge,
		categoryId: parsed.output.categoryId,
		includeHidden: parsed.output.includeHidden,
	});

	return json({ activities: result });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	// #4867 系 QM 監査 (S2) / PO 決裁 2026-09-09: **親だけが触ってよい経路**。
	//
	// `/api/v1/**` は `authorization.ts` の ROUTE_RULES が `['owner','parent','child']` に
	// 開けている (既存 test が固定している仕様)。つまり **child セッションはここに到達できる**
	// ので、「ここは親だけ」は各 route が言う以外にない。無いと子供が親の設定を書き換えられ、
	// **親が決め、子が記録する**という製品の中核が崩れる (ADR-0012 の前提)。
	//
	// **読み取り (GET) は閉じない** — 一覧を引けること自体は親限定と言い切れず、
	// PO 決裁が「判断が要るものは私へ」としているため。閉じるのは書き込みだけ。
	// role 判定はルート横断の唯一の seam (`requireRole`) 経由にする
	// (#3528 / 14-セキュリティ設計書 §5.2.3 §5.2.5。ハンドラ内の ad-hoc 判定は置かない)。
	const gate = parentGateResponse(locals);
	if (gate) return gate;
	const tenantId = context.tenantId;
	const body = await request.json();
	const parsed = v.safeParse(createActivitySchema, body);
	if (!parsed.success) {
		return validationError(parsed.issues[0]?.message ?? '入力が不正です');
	}

	// #3740: 親手動作成経路 (admin `create` action と同型) の quota gate。gate 未通過だと
	// free tier (maxActivities=3) が raw API 反復で上限を無制限に回避できる (課金境界執行)。
	const licenseStatus = context.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const limitCheck = await checkActivityLimit(tenantId, licenseStatus);
	if (!limitCheck.allowed) {
		// #4693 (QM 4 巡目): 数量制限は **機能ゲートの文型で返さない** (#4710 と同 class)。
		// planLimitError は `requiredTierWithUpgradeFor` で「〜はスタンダードプラン以上でご利用
		// いただけます」を組み立てるが、3 個までは実際に使えるので自己矛盾する。数量制限は
		// quotaLimitError + 「N 個までです」+ 導線 で言い切る。code/status は 403 /
		// PLAN_LIMIT_EXCEEDED のまま (client の分岐条件は変えない)。内訳は context でログにだけ残す。
		return quotaLimitError(PLAN_GATE_LABELS.activityLimitReachedWithUpgrade(limitCheck.max), {
			current: limitCheck.current,
			max: limitCheck.max,
			tenantId,
		});
	}

	// #3740: wire `source` ('seed'/'curriculum' 含む) を信頼すると quota 集計対象外の値を
	// 注入して上限を回避できるため、client-facing 経路では正準 'custom' を強制する。
	// seed / curriculum を指定できるのは内部 caller (seed.ts / import-service) のみ (trust 境界分離)。
	const activity = await createActivity(
		{ ...parsed.output, source: PARENT_CREATED_SOURCE },
		tenantId,
	);
	return json(activity, { status: 201 });
};
