// src/lib/server/security/rate-limiter.ts
// インメモリのシンプルなレートリミッター（Lambda 単一プロセス向け）

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// 1分ごとにストアをクリーンアップ
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
	if (cleanupTimer) return;
	cleanupTimer = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (now > entry.resetAt) store.delete(key);
		}
	}, 60 * 1000);
	// Node.js で timer がプロセス終了を妨げないようにする
	if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
		cleanupTimer.unref();
	}
}

/**
 * レートリミットチェック
 * @returns true = 許可, false = 拒否（レート超過）
 */
export function checkRateLimit(
	key: string,
	maxRequests: number,
	windowMs: number,
): { allowed: boolean; remaining: number; resetAt: number } {
	ensureCleanup();
	const now = Date.now();
	const entry = store.get(key);

	if (!entry || now > entry.resetAt) {
		const resetAt = now + windowMs;
		store.set(key, { count: 1, resetAt });
		return { allowed: true, remaining: maxRequests - 1, resetAt };
	}

	entry.count++;
	if (entry.count > maxRequests) {
		return { allowed: false, remaining: 0, resetAt: entry.resetAt };
	}

	return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/** API 用レートリミット: 100 req/min per IP */
export function checkApiRateLimit(ip: string) {
	return checkRateLimit(`api:${ip}`, 100, 60 * 1000);
}

/**
 * 認証ルートのレートリミット（メソッド別）
 * - POST（ログイン試行）: 30 req/min — ブルートフォース保護は account-lockout.ts が担当
 * - GET（ページ表示・リダイレクト）: 60 req/min — 複数タブ同時オープン等を許容
 */
export function checkAuthRateLimit(ip: string, method: string) {
	if (method === 'GET' || method === 'HEAD') {
		return checkRateLimit(`auth:get:${ip}`, 60, 60 * 1000);
	}
	return checkRateLimit(`auth:post:${ip}`, 30, 60 * 1000);
}
