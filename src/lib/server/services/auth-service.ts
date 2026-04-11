import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import {
	LOCKOUT_DURATION_MS,
	MAX_FAILED_ATTEMPTS,
	SESSION_MAX_AGE_SECONDS,
	SESSION_REFRESH_THRESHOLD_MS,
} from '$lib/domain/validation/auth';
import { getSetting, getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

// --- 型定義 ---
export interface LoginSuccess {
	sessionToken: string;
	expiresAt: string;
}

export type LoginResult =
	| LoginSuccess
	| { error: 'INVALID_PIN' }
	| { error: 'LOCKED_OUT'; lockedUntil: string }
	| { error: 'PIN_NOT_SET' };

export type SessionResult = { valid: true; refreshed: boolean } | { valid: false };

// --- PIN認証 ---
export async function login(pin: string, tenantId: string): Promise<LoginResult> {
	// 1) PIN設定済みか確認
	const pinHash = await getSetting('pin_hash', tenantId);
	if (!pinHash) {
		return { error: 'PIN_NOT_SET' };
	}

	// 2) ロックアウトチェック
	const lockedUntil = await getSetting('pin_locked_until', tenantId);
	if (lockedUntil && new Date(lockedUntil) > new Date()) {
		logger.warn('[AUTH] ロックアウト中のログイン試行', { context: { lockedUntil } });
		return { error: 'LOCKED_OUT', lockedUntil };
	}

	// 3) PIN検証
	const isValid = bcrypt.compareSync(pin, pinHash);
	if (!isValid) {
		await incrementFailedAttempts(tenantId);
		logger.warn('[AUTH] PIN認証失敗');
		return { error: 'INVALID_PIN' };
	}

	// 4) 成功: カウンターリセット + セッション発行
	await resetFailedAttempts(tenantId);
	const sessionToken = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

	await setSetting('session_token', sessionToken, tenantId);
	await setSetting('session_expires_at', expiresAt, tenantId);

	return { sessionToken, expiresAt };
}

// --- セッション検証 ---
export async function validateSession(token: string, tenantId: string): Promise<SessionResult> {
	if (!token) return { valid: false };

	const data = await getSettings(['session_token', 'session_expires_at'], tenantId);
	const storedToken = data.session_token;
	const expiresAt = data.session_expires_at;

	if (!storedToken || !expiresAt) return { valid: false };
	if (token !== storedToken) return { valid: false };
	if (new Date(expiresAt) <= new Date()) return { valid: false };

	// 自動リフレッシュ: 残り30日を切ったら延長
	const remaining = new Date(expiresAt).getTime() - Date.now();
	if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
		const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
		await setSetting('session_expires_at', newExpiresAt, tenantId);
		return { valid: true, refreshed: true };
	}

	return { valid: true, refreshed: false };
}

// --- ログアウト ---
export async function logout(tenantId: string): Promise<void> {
	await setSetting('session_token', '', tenantId);
	await setSetting('session_expires_at', '', tenantId);
}

// --- PIN初期設定 ---
export async function setupPin(pin: string, tenantId: string): Promise<void> {
	const hash = bcrypt.hashSync(pin, 10);
	await setSetting('pin_hash', hash, tenantId);
	await resetFailedAttempts(tenantId);
}

// --- PIN再確認 (セッション発行を伴わない検証専用) ---
// #771: 破壊的操作 (ダウングレード等) の二段階確認で使用する。
// login() と異なりセッションを発行しない純粋な PIN 検証のみを行う。
// ロックアウトと連続失敗カウンタは login() と共通化している。
export type VerifyPinResult =
	| { ok: true }
	| { ok: false; error: 'INVALID_PIN' }
	| { ok: false; error: 'LOCKED_OUT'; lockedUntil: string }
	| { ok: false; error: 'PIN_NOT_SET' };

export async function verifyPin(pin: string, tenantId: string): Promise<VerifyPinResult> {
	// 1) PIN設定済みか確認
	const pinHash = await getSetting('pin_hash', tenantId);
	if (!pinHash) {
		return { ok: false, error: 'PIN_NOT_SET' };
	}

	// 2) ロックアウトチェック
	const lockedUntil = await getSetting('pin_locked_until', tenantId);
	if (lockedUntil && new Date(lockedUntil) > new Date()) {
		logger.warn('[AUTH] ロックアウト中のPIN再確認試行', { context: { lockedUntil } });
		return { ok: false, error: 'LOCKED_OUT', lockedUntil };
	}

	// 3) PIN検証
	const isValid = bcrypt.compareSync(pin, pinHash);
	if (!isValid) {
		await incrementFailedAttempts(tenantId);
		logger.warn('[AUTH] PIN再確認失敗');
		return { ok: false, error: 'INVALID_PIN' };
	}

	// 4) 成功: カウンターリセットのみ (セッションは発行しない)
	await resetFailedAttempts(tenantId);
	return { ok: true };
}

// --- PIN設定有無の確認 (UI フォールバック判定用) ---
export async function isPinConfigured(tenantId: string): Promise<boolean> {
	const pinHash = await getSetting('pin_hash', tenantId);
	return !!pinHash;
}

// --- PIN変更 ---
export async function changePin(
	currentPin: string,
	newPin: string,
	tenantId: string,
): Promise<
	| { success: true }
	| { error: 'INVALID_CURRENT_PIN' }
	| { error: 'LOCKED_OUT'; lockedUntil: string }
> {
	// ロックアウトチェック
	const lockedUntil = await getSetting('pin_locked_until', tenantId);
	if (lockedUntil && new Date(lockedUntil) > new Date()) {
		logger.warn('[AUTH] ロックアウト中のPIN変更試行', { context: { lockedUntil } });
		return { error: 'LOCKED_OUT', lockedUntil };
	}

	// 現在のPIN検証
	const pinHash = await getSetting('pin_hash', tenantId);
	if (!pinHash || !bcrypt.compareSync(currentPin, pinHash)) {
		await incrementFailedAttempts(tenantId);
		logger.warn('[AUTH] PIN変更: 現在のPIN認証失敗');
		return { error: 'INVALID_CURRENT_PIN' };
	}

	// 新しいPINを設定
	const newHash = bcrypt.hashSync(newPin, 10);
	await setSetting('pin_hash', newHash, tenantId);
	await resetFailedAttempts(tenantId);

	logger.info('[AUTH] PIN変更完了');
	return { success: true };
}

// --- 内部ヘルパー ---
async function incrementFailedAttempts(tenantId: string): Promise<void> {
	const current = Number((await getSetting('pin_failed_attempts', tenantId)) ?? '0');
	const next = current + 1;
	await setSetting('pin_failed_attempts', String(next), tenantId);

	if (next >= MAX_FAILED_ATTEMPTS) {
		const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
		await setSetting('pin_locked_until', lockedUntil, tenantId);
		logger.warn(`[AUTH] ロックアウト発動: ${next}回連続失敗`, {
			context: { attempts: next, lockedUntil },
		});
	}
}

async function resetFailedAttempts(tenantId: string): Promise<void> {
	await setSetting('pin_failed_attempts', '0', tenantId);
	await setSetting('pin_locked_until', '', tenantId);
}
