import { redirect } from '@sveltejs/kit';
import { normalizeUiMode } from '$lib/domain/validation/age-tier';
import { getAllChildren, getChildById } from '$lib/server/services/child-service';
import { getDefaultChildId } from '$lib/server/services/default-child-service';
import type { PageServerLoad } from './$types';

/**
 * #576: ルート `/` の優先順位ロジック
 *
 * 新しいリダイレクト判定順:
 *   1. Cookie `selectedChildId` が有効 → そのホームへ（端末ごとの直近選択を尊重）
 *   2. tenant の `default_child_id` 設定が有効 → そのホームへ（家族全体の既定）
 *   3. 子供が 1 人しかいない → 自動選択（/switch を経由しない）
 *   4. 子供が複数 & 既定未設定 → /switch
 *   5. 子供 0 人 → /admin/children （追加促し）
 *
 * #571 再発防止: 旧 ui_mode (kinder/lower/upper/teen) を defensive に normalize してから
 * パスを組み立てる（子供レポが返してきた値を二重チェック）。
 */
export const load: PageServerLoad = async ({ cookies, locals }) => {
	const tenantId = locals.context?.tenantId;
	if (!tenantId) {
		// 未認証（Cognito モード等）→ ログインへ
		redirect(302, '/auth/login');
	}

	// ユーティリティ: 子供から安全なホーム URL を組み立てる
	const homeFor = (child: { uiMode: string | null }): string => {
		const normalized = normalizeUiMode(child.uiMode ?? 'preschool') ?? 'preschool';
		return `/${normalized}/home`;
	};

	// 1) Cookie 優先
	const cookieChildIdStr = cookies.get('selectedChildId');
	if (cookieChildIdStr) {
		const cookieChildId = Number(cookieChildIdStr);
		if (Number.isFinite(cookieChildId) && cookieChildId > 0) {
			const child = await getChildById(cookieChildId, tenantId);
			if (child) {
				redirect(302, homeFor(child));
			}
		}
	}

	// 2) tenant の既定子供
	const defaultChildId = await getDefaultChildId(tenantId);
	if (defaultChildId !== null) {
		const child = await getChildById(defaultChildId, tenantId);
		if (child) {
			redirect(302, homeFor(child));
		}
		// 既定が削除済み等の無効値だった場合は次へフォールバック
	}

	// 3) 子供が 1 人しかいない → 自動選択（/switch を経由しない）
	const children = await getAllChildren(tenantId);
	const onlyChild = children.length === 1 ? children[0] : undefined;
	if (onlyChild) {
		redirect(302, homeFor(onlyChild));
	}

	// 5) 子供 0 人 → 追加画面へ
	if (children.length === 0) {
		redirect(302, '/admin/children');
	}

	// 4) 子供が複数かつ既定未設定 → 選択画面
	redirect(302, '/switch');
};
