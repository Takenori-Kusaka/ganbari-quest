/**
 * ページガイドレジストリ
 *
 * 全ページのガイド定義を集約し、パスベースで取得する。
 */

import type { PageGuide } from './page-guide-types';

// 動的インポートでガイド定義を取得（バンドルサイズ最適化）
const GUIDE_LOADERS: Record<
	string,
	() => Promise<{ default?: PageGuide } & Record<string, PageGuide>>
> = {
	'/admin': () => import('../../../routes/(parent)/admin/_guide'),
	'/admin/children': () => import('../../../routes/(parent)/admin/children/_guide'),
	'/admin/activities': () => import('../../../routes/(parent)/admin/activities/_guide'),
	'/admin/rewards': () => import('../../../routes/(parent)/admin/rewards/_guide'),
	'/admin/points': () => import('../../../routes/(parent)/admin/points/_guide'),
	'/admin/reports': () => import('../../../routes/(parent)/admin/reports/_guide'),
	'/admin/messages': () => import('../../../routes/(parent)/admin/messages/_guide'),
	'/admin/settings': () => import('../../../routes/(parent)/admin/settings/_guide'),
};

// ガイド名とモジュールのエクスポート名のマッピング
const GUIDE_EXPORT_NAMES: Record<string, string> = {
	'/admin': 'ADMIN_HOME_GUIDE',
	'/admin/children': 'CHILDREN_GUIDE',
	'/admin/activities': 'ACTIVITIES_GUIDE',
	'/admin/rewards': 'REWARDS_GUIDE',
	'/admin/points': 'POINTS_GUIDE',
	'/admin/reports': 'REPORTS_GUIDE',
	'/admin/messages': 'MESSAGES_GUIDE',
	'/admin/settings': 'SETTINGS_GUIDE',
};

/**
 * パスに対応するページガイドを取得する。
 * ガイドが存在しないページの場合は null を返す。
 */
export async function getPageGuide(path: string): Promise<PageGuide | null> {
	// パスの正規化: 末尾スラッシュ除去、クエリパラメータ除去
	const normalized = path.replace(/\/$/, '').split('?')[0] ?? '';

	const loader = GUIDE_LOADERS[normalized];
	if (!loader) return null;

	try {
		const mod = await loader();
		const exportName = GUIDE_EXPORT_NAMES[normalized] ?? '';
		return (mod as Record<string, PageGuide>)[exportName] ?? null;
	} catch {
		return null;
	}
}

/** ガイドが存在するパスの一覧 */
export function getGuidePagePaths(): string[] {
	return Object.keys(GUIDE_LOADERS);
}

/** 全ガイドのページID一覧（完了状態表示用） */
export const ALL_PAGE_IDS = [
	'admin-home',
	'admin-children',
	'admin-activities',
	'admin-rewards',
	'admin-points',
	'admin-reports',
	'admin-messages',
	'admin-settings',
];
