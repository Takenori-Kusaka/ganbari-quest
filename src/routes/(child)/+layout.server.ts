import type { PointSettings } from '$lib/domain/point-display';
import { DEFAULT_POINT_SETTINGS } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { UI_MODES } from '$lib/domain/validation/age-tier';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings } from '$lib/server/db/settings-repo';
import { checkAndUnlockItems, getAvatarConfig } from '$lib/server/services/avatar-service';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { getActiveTitle } from '$lib/server/services/title-service';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ cookies, url, locals }) => {
	const tenantId = requireTenantId(locals);
	let childIdStr = cookies.get('selectedChildId');

	// context.childId がある場合（招待紐づけ済みの child ロール）は自動選択 (#0156)
	if (!childIdStr && locals.context?.childId) {
		childIdStr = String(locals.context.childId);
		cookies.set('selectedChildId', childIdStr, { path: '/', httpOnly: false, sameSite: 'lax' });
	}

	// /switch ページは子供未選択でもアクセス可能（無限リダイレクト防止）
	if (!childIdStr && url.pathname !== '/switch') {
		redirect(302, '/switch');
	}

	if (!childIdStr) {
		// /switch ページ用: 子供一覧だけ返す
		return {
			child: null,
			balance: 0,
			level: 1,
			levelTitle: 'かけだし',
			allChildren: await getAllChildren(tenantId),
			uiMode: 'kinder' as const,
			pointSettings: DEFAULT_POINT_SETTINGS,
		};
	}

	const childId = Number(childIdStr);
	const child = await getChildById(childId, tenantId);
	if (!child) {
		cookies.delete('selectedChildId', { path: '/' });
		redirect(302, '/switch');
	}

	const uiMode = child.uiMode ?? 'kinder';

	// 年齢帯不一致チェック: 異なるモードのルートにアクセスした場合リダイレクト
	const pathSegment = url.pathname.split('/')[1];
	if (
		pathSegment &&
		UI_MODES.includes(pathSegment as (typeof UI_MODES)[number]) &&
		pathSegment !== uiMode
	) {
		redirect(302, `/${uiMode}/home`);
	}

	const balanceResult = await getPointBalance(childId, tenantId);
	const balance = 'error' in balanceResult ? 0 : balanceResult.balance;

	const statusResult = await getChildStatus(childId, tenantId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const levelTitle = 'error' in statusResult ? 'かけだし' : statusResult.levelTitle;

	const activeTitle = await getActiveTitle(childId, tenantId);

	// きせかえアバター: 無料・レベル条件アイテムの自動解放
	await checkAndUnlockItems(childId, tenantId);
	const avatarConfig = await getAvatarConfig(childId, tenantId);

	// ポイント表示設定
	const pointSettingsRaw = await getSettings(
		['point_unit_mode', 'point_currency', 'point_rate'],
		tenantId,
	);
	const pointSettings: PointSettings = {
		mode: (pointSettingsRaw.point_unit_mode as PointUnitMode) ?? DEFAULT_POINT_SETTINGS.mode,
		currency: (pointSettingsRaw.point_currency as CurrencyCode) ?? DEFAULT_POINT_SETTINGS.currency,
		rate: Number.parseFloat(pointSettingsRaw.point_rate ?? '') || DEFAULT_POINT_SETTINGS.rate,
	};

	return {
		child,
		balance,
		level,
		levelTitle,
		activeTitle,
		avatarConfig,
		allChildren: await getAllChildren(tenantId),
		uiMode,
		pointSettings,
	};
};
