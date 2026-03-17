import { randomUUID } from 'node:crypto';
import {
	LOCKOUT_DURATION_MS,
	MAX_FAILED_ATTEMPTS,
	SESSION_MAX_AGE_SECONDS,
	SESSION_REFRESH_THRESHOLD_MS,
} from '$lib/domain/validation/auth';
import { getSetting, getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import bcrypt from 'bcrypt';

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
export function login(pin: string): LoginResult {
	// 1) PIN設定済みか確認
	const pinHash = getSetting('pin_hash');
	if (!pinHash) {
		return { error: 'PIN_NOT_SET' };
	}

	// 2) ロックアウトチェック
	const lockedUntil = getSetting('pin_locked_until');
	if (lockedUntil && new Date(lockedUntil) > new Date()) {
		logger.warn('[AUTH] ロックアウト中のログイン試行', { context: { lockedUntil } });
		return { error: 'LOCKED_OUT', lockedUntil };
	}

	// 3) PIN検証
	const isValid = bcrypt.compareSync(pin, pinHash);
	if (!isValid) {
		incrementFailedAttempts();
		logger.warn('[AUTH] PIN認証失敗');
		return { error: 'INVALID_PIN' };
	}

	// 4) 成功: カウンターリセット + セッション発行
	resetFailedAttempts();
	const sessionToken = randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

	setSetting('session_token', sessionToken);
	setSetting('session_expires_at', expiresAt);

	return { sessionToken, expiresAt };
}

// --- セッション検証 ---
export function validateSession(token: string): SessionResult {
	if (!token) return { valid: false };

	const data = getSettings(['session_token', 'session_expires_at']);
	const storedToken = data.session_token;
	const expiresAt = data.session_expires_at;

	if (!storedToken || !expiresAt) return { valid: false };
	if (token !== storedToken) return { valid: false };
	if (new Date(expiresAt) <= new Date()) return { valid: false };

	// 自動リフレッシュ: 残り30日を切ったら延長
	const remaining = new Date(expiresAt).getTime() - Date.now();
	if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
		const newExpiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
		setSetting('session_expires_at', newExpiresAt);
		return { valid: true, refreshed: true };
	}

	return { valid: true, refreshed: false };
}

// --- ログアウト ---
export function logout(): void {
	setSetting('session_token', '');
	setSetting('session_expires_at', '');
}

// --- PIN初期設定 ---
export function setupPin(pin: string): void {
	const hash = bcrypt.hashSync(pin, 10);
	setSetting('pin_hash', hash);
	resetFailedAttempts();
}

// --- PIN変更 ---
export function changePin(
	currentPin: string,
	newPin: string,
):
	| { success: true }
	| { error: 'INVALID_CURRENT_PIN' }
	| { error: 'LOCKED_OUT'; lockedUntil: string } {
	// ロックアウトチェック
	const lockedUntil = getSetting('pin_locked_until');
	if (lockedUntil && new Date(lockedUntil) > new Date()) {
		logger.warn('[AUTH] ロックアウト中のPIN変更試行', { context: { lockedUntil } });
		return { error: 'LOCKED_OUT', lockedUntil };
	}

	// 現在のPIN検証
	const pinHash = getSetting('pin_hash');
	if (!pinHash || !bcrypt.compareSync(currentPin, pinHash)) {
		incrementFailedAttempts();
		logger.warn('[AUTH] PIN変更: 現在のPIN認証失敗');
		return { error: 'INVALID_CURRENT_PIN' };
	}

	// 新しいPINを設定
	const newHash = bcrypt.hashSync(newPin, 10);
	setSetting('pin_hash', newHash);
	resetFailedAttempts();

	logger.info('[AUTH] PIN変更完了');
	return { success: true };
}

// --- 内部ヘルパー ---
function incrementFailedAttempts(): void {
	const current = Number(getSetting('pin_failed_attempts') ?? '0');
	const next = current + 1;
	setSetting('pin_failed_attempts', String(next));

	if (next >= MAX_FAILED_ATTEMPTS) {
		const lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
		setSetting('pin_locked_until', lockedUntil);
		logger.warn(`[AUTH] ロックアウト発動: ${next}回連続失敗`, {
			context: { attempts: next, lockedUntil },
		});
	}
}

function resetFailedAttempts(): void {
	setSetting('pin_failed_attempts', '0');
	setSetting('pin_locked_until', '');
}
