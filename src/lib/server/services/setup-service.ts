import { logger } from '$lib/server/logger';
import { getAllChildren, getArchivedChildren } from '$lib/server/services/child-service';

/**
 * Returns true if the initial setup wizard has not been completed yet.
 * Setup is required when no children have ever been registered (active or archived).
 *
 * #783 で archive 機能が追加されたが、セットアップ判定はアーカイブ状態に
 * 依存すべきではない。子供が 1 人でも存在すれば（active/archived 問わず）
 * セットアップは完了とみなす。
 */
export async function isSetupRequired(tenantId: string): Promise<boolean> {
	try {
		const active = await getAllChildren(tenantId);
		if (active.length > 0) return false;
		const archived = await getArchivedChildren(tenantId);
		return archived.length === 0;
	} catch (err) {
		// DB スキーマ不整合（is_archived カラム未追加等）時はセットアップ済みと
		// みなしてリダイレクトループを防ぐ
		logger.warn('[SETUP] isSetupRequired failed, assuming setup done', {
			context: { tenantId, error: String(err) },
		});
		return false;
	}
}
