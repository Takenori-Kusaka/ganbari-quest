import { redirect } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { CurrencyCode, PointSettings, PointUnitMode } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { UI_MODES } from '$lib/domain/validation/age-tier';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings } from '$lib/server/db/settings-repo';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import { DEMO_PLAN_COOKIE, resolveDemoPlan } from '$lib/server/demo/demo-plan';
import { getDemoChildLayoutData } from '$lib/server/demo/demo-service';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { markChildScreenVisited } from '$lib/server/services/onboarding-service';
import {
	getPlanLimits,
	isPaidTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getStampCardStatus } from '$lib/server/services/stamp-card-service';
import { getChildStatus } from '$lib/server/services/status-service';
import {
	getTenantValuePreview,
	type MilestoneAchievement,
} from '$lib/server/services/value-preview-service';
import type { LayoutServerLoad } from './$types';

/**
 * #1600 ADR-0023 I9: 指定 child のマイルストーン進捗を取得する。
 * 取得失敗時は空配列フォールバック（バナー非表示）で child UI 全体を守る。
 */
async function loadMilestonesForChild(
	tenantId: string,
	childId: number,
): Promise<MilestoneAchievement[]> {
	try {
		const preview = await getTenantValuePreview(tenantId);
		const childPreview = preview.children.find((c) => c.childId === childId);
		return childPreview?.milestones ?? [];
	} catch {
		return [];
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ADR-0039 Phase 2 (#2097) で demo data 経路を入れたため複雑度上昇。本番ルートと demo data の 2 経路を 1 layout に統合する設計上避けられない。別 Issue でリファクタ予定。
export const load: LayoutServerLoad = async ({ cookies, url, locals }) => {
	// ADR-0039 Phase 2 (#2097): デモ実行モード時は本番ルートで動きつつ
	// demo-service の in-memory data を返す。本番 service は無改変
	// (write は hooks の shouldReturnDemoNoop で 200 no-op 化済)。
	if (locals.isDemo) {
		const childIdParam = url.searchParams.get('childId');
		const pathSegment = url.pathname.split('/')[1];
		const pathMode = UI_MODES.includes(pathSegment as (typeof UI_MODES)[number])
			? pathSegment
			: undefined;

		// childId 優先順位: ?childId= → uiMode から対応する demo child を選択 → 902 (LP 代表)
		let demoChildId: number | null = childIdParam ? Number(childIdParam) : null;
		if (!demoChildId && pathMode) {
			const child = DEMO_CHILDREN.find((c) => c.uiMode === pathMode);
			demoChildId = child?.id ?? null;
		}
		if (!demoChildId) {
			// /switch 等の uiMode 無し pathの場合、902 (preschool, LP 代表) をデフォルト
			demoChildId = 902;
		}

		const demoData = getDemoChildLayoutData(demoChildId);
		const planQuery = url.searchParams.get('plan');
		const planCookie = cookies.get(DEMO_PLAN_COOKIE);
		const demoPlan = resolveDemoPlan(planQuery, planCookie);
		const planTier =
			demoPlan === 'family' ? 'family' : demoPlan === 'standard' ? 'standard' : 'free';

		return {
			child: demoData.child,
			balance: demoData.balance,
			level: demoData.level,
			levelTitle: demoData.levelTitle,
			allChildren: demoData.allChildren,
			uiMode: demoData.uiMode,
			pointSettings: demoData.pointSettings,
			stampProgress: null,
			stampCard: null,
			isPremium: planTier !== 'free',
			planTier,
			planLimits: getPlanLimits(planTier),
			milestones: [] as MilestoneAchievement[],
			demoPlan,
		};
	}

	const tenantId = requireTenantId(locals);
	let childIdStr = cookies.get('selectedChildId');

	// context.childId がある場合（招待紐づけ済みの child ロール）は自動選択 (#0156)
	if (!childIdStr && locals.context?.childId) {
		childIdStr = String(locals.context.childId);
		cookies.set('selectedChildId', childIdStr, { path: '/', httpOnly: false, sameSite: 'lax' });
	}

	// 子供未選択の場合は /switch にリダイレクト
	if (!childIdStr) {
		redirect(302, '/switch');
	}

	const childId = Number(childIdStr);
	const child = await getChildById(childId, tenantId);
	if (!child) {
		cookies.delete('selectedChildId', { path: '/' });
		redirect(302, '/switch');
	}

	const uiMode = child.uiMode ?? 'preschool';

	// 全モード実装済み (#0167)
	const effectiveMode = UI_MODES.includes(uiMode as (typeof UI_MODES)[number])
		? uiMode
		: 'preschool';

	// 年齢帯不一致チェック: 異なるモードのルートにアクセスした場合リダイレクト
	const pathSegment = url.pathname.split('/')[1];
	if (
		pathSegment &&
		UI_MODES.includes(pathSegment as (typeof UI_MODES)[number]) &&
		pathSegment !== effectiveMode
	) {
		redirect(302, `/${effectiveMode}/home`);
	}

	// 独立したDB呼び出しを並列実行（LCP改善）
	const [balanceResult, statusResult, allChildren, pointSettingsRaw, stampCardResult] =
		await Promise.all([
			getPointBalance(childId, tenantId),
			getChildStatus(childId, tenantId),
			getAllChildren(tenantId),
			getSettings(['point_unit_mode', 'point_currency', 'point_rate'], tenantId),
			getStampCardStatus(childId, tenantId),
		]);

	// #1600 ADR-0023 I9: マイルストーン進捗を child layout で取得
	const milestones = await loadMilestonesForChild(tenantId, childId);

	const balance = 'error' in balanceResult ? 0 : balanceResult.balance;
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const levelTitle = 'error' in statusResult ? 'かけだし' : statusResult.levelTitle;

	const pointSettings: PointSettings = {
		mode: (pointSettingsRaw.point_unit_mode as PointUnitMode) ?? DEFAULT_POINT_SETTINGS.mode,
		currency: (pointSettingsRaw.point_currency as CurrencyCode) ?? DEFAULT_POINT_SETTINGS.currency,
		rate: Number.parseFloat(pointSettingsRaw.point_rate ?? '') || DEFAULT_POINT_SETTINGS.rate,
	};

	const stampProgress =
		!stampCardResult || 'error' in stampCardResult
			? null
			: { filled: stampCardResult.filledSlots, total: stampCardResult.totalSlots };

	// オンボーディング「子供の画面を確認する」を自動マーク（fire-and-forget）
	markChildScreenVisited(tenantId).catch(() => {});

	// #789: プラン情報を child UI 配下で一元的に参照できるよう layout に集約する。
	// 従来は各 +page.server.ts が個別に resolveFullPlanTier を呼び直しており、
	// 「child 側で planTier を取得する手段が無い」状態だった。
	// 本 layout で 1 回だけ解決し、planTier / planLimits / isPremium を配布する。
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	const planLimits = getPlanLimits(planTier);
	const isPremium = isPaidTier(planTier);

	return {
		child,
		balance,
		level,
		levelTitle,
		allChildren,
		uiMode: effectiveMode,
		pointSettings,
		stampProgress,
		stampCard: !stampCardResult || 'error' in stampCardResult ? null : stampCardResult,
		isPremium,
		planTier,
		planLimits,
		milestones,
	};
};
