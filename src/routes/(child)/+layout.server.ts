import { UI_MODES } from '$lib/domain/validation/age-tier';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { getAvatarConfig, checkAndUnlockItems } from '$lib/server/services/avatar-service';
import { getActiveTitle } from '$lib/server/services/title-service';
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies, url }) => {
	const childIdStr = cookies.get('selectedChildId');

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
			allChildren: getAllChildren(),
			uiMode: 'kinder' as const,
		};
	}

	const childId = Number(childIdStr);
	const child = getChildById(childId);
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

	const balanceResult = getPointBalance(childId);
	const balance = 'error' in balanceResult ? 0 : balanceResult.balance;

	const statusResult = getChildStatus(childId);
	const level = 'error' in statusResult ? 1 : statusResult.level;
	const levelTitle = 'error' in statusResult ? 'かけだし' : statusResult.levelTitle;

	const activeTitle = getActiveTitle(childId);

	// きせかえアバター: 無料・レベル条件アイテムの自動解放
	checkAndUnlockItems(childId);
	const avatarConfig = getAvatarConfig(childId);

	return {
		child,
		balance,
		level,
		levelTitle,
		activeTitle,
		avatarConfig,
		allChildren: getAllChildren(),
		uiMode,
	};
};
