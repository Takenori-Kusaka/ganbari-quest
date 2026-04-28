// src/lib/server/services/last-active-touch.ts
// #1601 (ADR-0023 §5 I11): Tenant.lastActiveAt の 1 日 1 回ガード付き更新。
//
// hooks.server.ts から認証成功後に呼ばれるホットパスのため、
// 同日中の重複呼び出しを in-memory cache で吸収する。
// プロセス再起動 (Lambda cold start 等) で cache は消えるが、その場合は
// 再度 1 回だけ書き込みが走るだけで害はない。
//
// 設計判断:
//   - localStorage / cookie 等のクライアント側ガードは使わない (改竄可能)
//   - DynamoDB に「最後に書いた日付」を都度問い合わせる方式は RW コストが倍になる
//     ため、in-memory cache (LRU 風 Map) で十分
//   - cache は 10000 テナント上限で truncation する (Pre-PMF 想定 << 10000)

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

const CACHE_MAX_SIZE = 10_000;

/** tenantId → 最後に lastActiveAt を書いた YYYY-MM-DD (UTC) */
const lastTouchCache = new Map<string, string>();

/** UTC YYYY-MM-DD を返す */
function getDayKey(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10); // 2026-04-27
}

/**
 * テスト用: cache をリセットする。
 * 通常コードからは呼ばないこと。
 */
export function _resetLastActiveTouchCacheForTesting(): void {
	lastTouchCache.clear();
}

/**
 * テナントの lastActiveAt を更新する (1 日 1 回ガード付き)。
 *
 * - 当日中に既に書き込み済みなら no-op (DB に行かない)
 * - 失敗しても例外は投げない (hooks のホットパスを止めないため)
 *
 * @param tenantId 対象テナント。'demo' / 'local' / falsy ならスキップ。
 */
export async function touchTenantLastActive(tenantId: string | undefined | null): Promise<void> {
	if (!tenantId) return;
	if (tenantId === 'demo' || tenantId === 'local') return;

	const today = getDayKey();
	const lastDay = lastTouchCache.get(tenantId);
	if (lastDay === today) return; // 当日中は cache hit で skip

	// LRU 簡易実装: 上限を超えたら最古エントリを削除
	if (lastTouchCache.size >= CACHE_MAX_SIZE) {
		const firstKey = lastTouchCache.keys().next().value;
		if (firstKey !== undefined) lastTouchCache.delete(firstKey);
	}

	const nowIso = new Date().toISOString();
	try {
		const repos = getRepos();
		await repos.auth.updateTenantLastActiveAt(tenantId, nowIso);
		lastTouchCache.set(tenantId, today);
	} catch (err) {
		// hooks の主処理を止めないため、ベストエフォート扱い
		logger.warn('[last-active-touch] failed to update lastActiveAt', {
			context: { tenantId, error: err instanceof Error ? err.message : String(err) },
		});
	}
}
