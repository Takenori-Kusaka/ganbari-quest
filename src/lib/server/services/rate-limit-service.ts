// src/lib/server/services/rate-limit-service.ts
// #813: ライセンスキー validate / consume API のレート制限
//
// NOTE: 本モジュールは `src/lib/server/security/rate-limiter.ts` (汎用レートリミッター)
// とは意図的に分離している。汎用版は IP 単位のシンプルなスライディングウィンドウカウンタ
// であり、hooks.server.ts で全 API / 認証ルートに一律適用される。
// 本サービスは以下のドメイン固有要件を追加するために独立実装:
//   1. 二次元レート制限 — IP と email を同時にチェックし、片方でも超過すればブロック
//   2. Discord incident 通知 — 超過検知時に discord-notify-service 経由でアラート送信（重複抑制付き）
//   3. ライセンスキー固有のビジネスロジック — signup / license-apply のアクション区別、
//      ユーザー向けメッセージ生成、retryAfterSec の算出
// 汎用 rate-limiter.ts を拡張するよりも、責務の明確な分離を優先した。
//
// インメモリの Map ベースで IP 単位・email 単位のレート制限を行う。
// Lambda 環境ではインスタンスごとに Map が独立するが、ブルートフォース攻撃は
// 同一インスタンスに集中する傾向が高いため、実用上十分な防御となる。

import { logger } from '$lib/server/logger';
import { notifyIncident } from '$lib/server/services/discord-notify-service';

// --- 設定 ---

/** IP 単位: windowMs 内に maxAttempts を超えたらブロッ�� */
const IP_WINDOW_MS = 60 * 1000; // 1 分
const IP_MAX_ATTEMPTS = 10;

/** email 単位: windowMs 内に maxAttempts を超えたらブロック */
const EMAIL_WINDOW_MS = 60 * 60 * 1000; // 1 時間
const EMAIL_MAX_ATTEMPTS = 20;

/** Map のエントリ数が肥大化しないよう定期的に掃除する閾値 */
const CLEANUP_THRESHOLD = 5000;

// --- 型 ---

interface RateLimitEntry {
	/** ウィンドウ開始時刻 */
	windowStart: number;
	/** ウィンドウ内の試行回数 */
	count: number;
}

// --- ストア ---

const ipStore = new Map<string, RateLimitEntry>();
const emailStore = new Map<string, RateLimitEntry>();

// Discord 通知の重複を避けるため、通知済みキーを短時間キャッシュ
const notifiedKeys = new Map<string, number>();
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000; // 10 分間は同じキーで再通知しない

// --- 内部ヘルパー ---

function cleanupStore(store: Map<string, RateLimitEntry>, windowMs: number): void {
	if (store.size < CLEANUP_THRESHOLD) return;
	const now = Date.now();
	for (const [key, entry] of store) {
		if (now - entry.windowStart > windowMs) {
			store.delete(key);
		}
	}
}

/**
 * 汎用のスライディングウィンドウ風レートチェック。
 * ウィンドウが経過したらカウントをリセットする。
 * @returns `true` = 許可、`false` = 制限中
 */
function checkRate(
	store: Map<string, RateLimitEntry>,
	key: string,
	windowMs: number,
	maxAttempts: number,
): { allowed: boolean; count: number; retryAfterMs: number } {
	const now = Date.now();
	const entry = store.get(key);

	if (!entry || now - entry.windowStart > windowMs) {
		// 新規ウィンドウ開始
		store.set(key, { windowStart: now, count: 1 });
		cleanupStore(store, windowMs);
		return { allowed: true, count: 1, retryAfterMs: 0 };
	}

	entry.count += 1;

	if (entry.count > maxAttempts) {
		const retryAfterMs = windowMs - (now - entry.windowStart);
		return { allowed: false, count: entry.count, retryAfterMs };
	}

	return { allowed: true, count: entry.count, retryAfterMs: 0 };
}

// --- 公開 API ---

export interface RateLimitResult {
	allowed: boolean;
	/** 制限中の場合、何秒後に再試行可能か */
	retryAfterSec: number;
	/** ユーザー向けメッセージ */
	message: string;
}

/**
 * ライセンスキー検証のレート制限チェック。
 * IP と email の両方をチェックし、どち��か一方でも超過したらブロック。
 *
 * @param ip - クライアント IP アドレス（SvelteKit `getClientAddress()` 経由）。
 *   AWS Lambda デプロイでは CloudFront → ALB → Lambda の経路で X-Forwarded-For が
 *   インフラ側でセットされるため、IP の信頼性はデプロイ構成に依存する。
 *   ローカル (NUC) 環境では LAN 内 IP となるため、レート制限の実効性は限定的。
 * @param email - ユーザーのメールアドレス（未認証の場合は空文字可）
 * @param action - アクション名（ログ用: 'signup' | 'license-apply'）
 */
export async function checkLicenseKeyRateLimit(
	ip: string,
	email: string,
	action: string,
): Promise<RateLimitResult> {
	// IP チェック
	const ipResult = checkRate(ipStore, ip, IP_WINDOW_MS, IP_MAX_ATTEMPTS);
	if (!ipResult.allowed) {
		const retryAfterSec = Math.ceil(ipResult.retryAfterMs / 1000);
		await notifyRateLimitBreach('ip', ip, email, action, ipResult.count);
		logger.warn('[RATE-LIMIT] IP rate limit exceeded', {
			context: { ip, email, action, count: ipResult.count },
		});
		return {
			allowed: false,
			retryAfterSec,
			message: `試行回数が上限を超えました。${retryAfterSec}秒後にお試しください`,
		};
	}

	// email チェック（空文字の場合はスキップ）
	if (email) {
		const emailResult = checkRate(
			emailStore,
			email.toLowerCase(),
			EMAIL_WINDOW_MS,
			EMAIL_MAX_ATTEMPTS,
		);
		if (!emailResult.allowed) {
			const retryAfterSec = Math.ceil(emailResult.retryAfterMs / 1000);
			await notifyRateLimitBreach('email', ip, email, action, emailResult.count);
			logger.warn('[RATE-LIMIT] Email rate limit exceeded', {
				context: { ip, email, action, count: emailResult.count },
			});
			return {
				allowed: false,
				retryAfterSec,
				message: `試行回数が上限を���えました。しばらくし��から再度お試しください`,
			};
		}
	}

	return { allowed: true, retryAfterSec: 0, message: '' };
}

/**
 * レート制限超過時に Discord incident チャネルへ通知（重複抑制付き）
 */
async function notifyRateLimitBreach(
	type: 'ip' | 'email',
	ip: string,
	email: string,
	action: string,
	count: number,
): Promise<void> {
	const notifyKey = `${type}:${type === 'ip' ? ip : email}`;
	const lastNotified = notifiedKeys.get(notifyKey);
	if (lastNotified && Date.now() - lastNotified < NOTIFY_COOLDOWN_MS) {
		return; // クールダウン中
	}
	notifiedKeys.set(notifyKey, Date.now());

	// 古い通知キャッシュを掃除
	if (notifiedKeys.size > 1000) {
		const now = Date.now();
		for (const [key, ts] of notifiedKeys) {
			if (now - ts > NOTIFY_COOLDOWN_MS) notifiedKeys.delete(key);
		}
	}

	await notifyIncident(`⚠️ ライセンスキー検証のレート制限超過 (${type}, ${count}回目)`, {
		method: 'POST',
		path: action === 'signup' ? '/auth/signup' : '/admin/license',
	}).catch(() => {
		// Discord 通知失敗は握りつぶし（レート制限自体は機能する）
	});
}

// --- テスト用リセット ---

/** テスト用: 全ストアをクリアする */
export function _resetForTest(): void {
	ipStore.clear();
	emailStore.clear();
	notifiedKeys.clear();
}
