/**
 * Marketplace source adapter — ADR-0052 (Issue #2365)
 *
 * `$lib/data/marketplace` SSOT から型 ID 経由で raw payload を取り出す source adapter。
 * Strategy の `parse()` に渡す `unknown` を生成する責務のみ持ち、validation や
 * tenant 解決は呼出側 ( `dispatchImport()` ) が担当する。
 *
 * 設計原則 (ADR-0052 §3.2):
 *   - source adapter は「どこから raw payload を持ってくるか」を抽象化する 1 層
 *   - validation は Strategy.parse() (Valibot schema) の責務
 *   - DB write は Strategy.apply() の責務 (本ファイルは触らない)
 *
 * 関連:
 *   - ADR-0052 (Strategy + Source 分離)
 *   - ADR-0014 / #1350 (OSS 先調査)
 *   - $lib/data/marketplace (公式 marketplace SSOT)
 */

import { getMarketplaceItem } from '$lib/data/marketplace';
import type { MarketplaceItemType } from '$lib/domain/marketplace-item';

/**
 * Source 取得結果。`payload` は Strategy.parse() に渡す raw データ。
 * `displayName` は import 結果メッセージに使う human-readable name。
 */
export interface MarketplaceSourceResult {
	payload: unknown;
	displayName: string;
	itemId: string;
}

/**
 * 公式 marketplace SSOT から特定 itemId の payload を取り出す。
 *
 * @throws Error item が存在しない場合
 */
export function loadFromMarketplace(
	type: MarketplaceItemType,
	itemId: string,
): MarketplaceSourceResult {
	const item = getMarketplaceItem(type, itemId);
	if (!item) {
		throw new Error(
			`[marketplace-source] type="${type}" itemId="${itemId}" not found in marketplace SSOT.`,
		);
	}
	return {
		payload: item.payload as unknown,
		displayName: item.name,
		itemId,
	};
}
