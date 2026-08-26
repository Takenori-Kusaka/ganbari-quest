// /view/[token] — 閲覧専用リンクのサーバーロード (#371)
// 認証不要。トークンの有効性のみ検証。

import { error } from '@sveltejs/kit';
import { asCategoryId, type CategoryId } from '$lib/domain/ids';
import { VIEW_PAGE_LABELS } from '$lib/domain/labels';
import { getAllChildren } from '$lib/server/services/child-service';
import { getPointBalance } from '$lib/server/services/point-service';
import { getChildStatus } from '$lib/server/services/status-service';
import { resolveViewerToken } from '$lib/server/services/viewer-token-service';
import type { PageServerLoad } from './$types';

/**
 * #4703: 画面に渡す 1 人分の形。
 *
 * `totalPoints` を `number` と宣言することが本 Issue の修正の芯。旧実装は
 * `getPointBalance()` の戻り値 (`PointBalance | { error }`) をそのまま代入しており、
 * `+page.svelte` の `.toLocaleString()` が「[object Object] ポイント」を描いていた。
 * 型で受け止めることで、同じ取り違えがコンパイル時に落ちる。
 */
interface ViewerChildData {
	nickname: string;
	age: number;
	totalPoints: number;
	totalLevel: number;
	statuses: { categoryId: CategoryId; level: number; totalXp: number }[];
}

export const load: PageServerLoad = async ({ params }) => {
	const viewer = await resolveViewerToken(params.token);
	if (!viewer) {
		// #4703: 汎用 404 (「ページが みつかりません」) ではなく、リンクを共有された人に
		// 「このリンクは無効か、期限切れです」を出すため reason を付ける
		// (メッセージ本文ではなくキーで分岐する = 内部例外の非露出、ADR-0062)。
		error(404, { message: VIEW_PAGE_LABELS.invalidTokenTitle, reason: 'viewer-token-invalid' });
	}

	const tenantId = viewer.tenantId;
	const children = await getAllChildren(tenantId);

	const childrenData: ViewerChildData[] = await Promise.all(
		children.map(async (child) => {
			const [balance, statusResult] = await Promise.all([
				getPointBalance(child.id, tenantId),
				getChildStatus(child.id, tenantId),
			]);

			// 子供が引けない (NOT_FOUND) ときは 0。閲覧専用リンクは読むだけの画面なので、
			// 1 人分が引けなくても他の子の表示は壊さない。
			const totalPoints = 'error' in balance ? 0 : balance.balance;

			if ('error' in statusResult) {
				return {
					nickname: child.nickname,
					age: child.age,
					totalPoints,
					totalLevel: 0,
					statuses: [],
				};
			}

			const statusEntries = Object.entries(statusResult.statuses).map(([catId, s]) => ({
				categoryId: asCategoryId(catId),
				level: s.level,
				totalXp: s.value,
			}));
			const totalLevel = statusEntries.reduce((sum, s) => sum + s.level, 0);

			return {
				nickname: child.nickname,
				age: child.age,
				totalPoints,
				totalLevel,
				statuses: statusEntries,
			};
		}),
	);

	return {
		label: viewer.label,
		childrenData,
	};
};
