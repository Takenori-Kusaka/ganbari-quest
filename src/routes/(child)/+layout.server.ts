import { redirect } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { CurrencyCode, PointSettings, PointUnitMode } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import { UI_MODES } from '$lib/domain/validation/age-tier';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings } from '$lib/server/db/settings-repo';
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

export const load: LayoutServerLoad = async ({ cookies, url, locals }) => {
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
