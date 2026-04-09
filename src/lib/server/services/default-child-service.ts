/**
 * #576: 「既定の子供」の永続化サービス
 *
 * tenant スコープの設定 `default_child_id` を読み書きする。
 * Cookie ベースの「前回選択」とは独立した概念であり、家族全体の既定として扱う。
 *
 * 優先順位（`src/routes/+page.server.ts` 参照）:
 *   1. Cookie `selectedChildId` (端末ごとの直近選択)
 *   2. `default_child_id` 設定 (家族全体の既定 ← 本サービス)
 *   3. 子供が 1 人 → 自動選択
 *   4. /switch へ
 */

import { getSetting, setSetting } from '$lib/server/db/settings-repo';

const KEY = 'default_child_id';

/**
 * 設定済みの既定子供 ID を取得する。未設定 or 不正値の場合は null。
 */
export async function getDefaultChildId(tenantId: string): Promise<number | null> {
	const raw = await getSetting(KEY, tenantId);
	if (!raw) return null;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return null;
	return parsed;
}

/**
 * 既定子供 ID を設定する。null を渡すとクリア（空文字列を保存）。
 */
export async function setDefaultChildId(tenantId: string, childId: number | null): Promise<void> {
	await setSetting(KEY, childId === null ? '' : String(childId), tenantId);
}
