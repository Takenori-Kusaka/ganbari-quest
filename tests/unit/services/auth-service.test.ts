// tests/unit/services/auth-service.test.ts
// 認証サービスのユニットテスト

import bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import { assertError, assertSuccess } from '../helpers/assert-result';
import { closeDb, createTestDb, type TestDb, type TestSqlite } from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

import { getSetting } from '../../../src/lib/server/db/settings-repo';
import {
	isPinConfigured,
	login,
	logout,
	setupPin,
	validateSession,
	verifyPin,
} from '../../../src/lib/server/services/auth-service';

// テスト用 PIN（bcrypt ハッシュして seed する任意の値）
const TEST_PIN = '1234';
// おやカギコードのデフォルト値 (#1360)
const OYAKAGI_DEFAULT_PIN = '5086';
let testPinHash: string;

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
	testPinHash = bcrypt.hashSync(TEST_PIN, 10);
});

afterAll(() => {
	closeDb(sqlite);
});

function seedAuthSettings(pinHash: string = testPinHash) {
	// settings テーブルをクリア
	sqlite.exec('DELETE FROM settings');
	testDb
		.insert(schema.settings)
		.values([
			{ key: 'pin_hash', value: pinHash },
			{ key: 'session_token', value: '' },
			{ key: 'session_expires_at', value: '' },
			{ key: 'pin_failed_attempts', value: '0' },
			{ key: 'pin_locked_until', value: '' },
		])
		.run();
}

describe('auth-service', () => {
	beforeEach(() => {
		seedAuthSettings();
	});

	// --- login ---
	describe('login', () => {
		it('正しいPINでログイン成功', async () => {
			const result = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			expect(result.sessionToken).toBeDefined();
			expect(result.sessionToken.length).toBeGreaterThan(0);
			expect(result.expiresAt).toBeDefined();
		});

		it('ログイン成功後にsettingsにセッションが保存される', async () => {
			const result = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			const storedToken = await getSetting('session_token', 'test-tenant');
			expect(storedToken).toBe(result.sessionToken);
		});

		it('間違ったPINでログイン失敗', async () => {
			const result = await login('9999', 'test-tenant');
			expect(result).toEqual({ error: 'INVALID_PIN' });
		});

		// #1360: pin_hash 未設定時は DEFAULT_PIN (5086) でフォールバック
		it('pin_hash 未設定時はデフォルトおやカギコード 5086 でログイン成功', async () => {
			seedAuthSettings('');
			const result = await login(OYAKAGI_DEFAULT_PIN, 'test-tenant');
			expect('error' in result).toBe(false);
		});

		it('pin_hash 未設定時に 5086 以外は INVALID_PIN', async () => {
			seedAuthSettings('');
			const result = await login('1234', 'test-tenant');
			expect(result).toEqual({ error: 'INVALID_PIN' });
		});

		it('間違ったPINで失敗カウントが増加する', async () => {
			await login('9999', 'test-tenant');
			const attempts = await getSetting('pin_failed_attempts', 'test-tenant');
			expect(attempts).toBe('1');
		});

		it('5回失敗でロックアウト', async () => {
			for (let i = 0; i < 5; i++) {
				await login('9999', 'test-tenant');
			}
			const result = assertError(await login(TEST_PIN, 'test-tenant'));
			expect(result.error).toBe('LOCKED_OUT');
		});

		it('ロックアウト期間経過後はログイン可能', async () => {
			// 5回失敗させてロック
			for (let i = 0; i < 5; i++) {
				await login('9999', 'test-tenant');
			}
			// ロック期限を過去に設定
			const pastDate = new Date(Date.now() - 1000).toISOString();
			testDb
				.insert(schema.settings)
				.values({ key: 'pin_locked_until', value: pastDate })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { value: pastDate },
				})
				.run();

			assertSuccess(await login(TEST_PIN, 'test-tenant'));
		});

		it('ログイン成功で失敗カウントがリセットされる', async () => {
			// 3回失敗
			await login('9999', 'test-tenant');
			await login('9999', 'test-tenant');
			await login('9999', 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('3');

			// 正しいPINで成功
			await login(TEST_PIN, 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('0');
		});
	});

	// --- validateSession ---
	describe('validateSession', () => {
		it('有効なトークンでvalid: true', async () => {
			const loginResult = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			const result = await validateSession(loginResult.sessionToken, 'test-tenant');
			expect(result.valid).toBe(true);
		});

		it('不正なトークンでvalid: false', async () => {
			await login(TEST_PIN, 'test-tenant');
			const result = await validateSession('invalid-token', 'test-tenant');
			expect(result.valid).toBe(false);
		});

		it('空トークンでvalid: false', async () => {
			const result = await validateSession('', 'test-tenant');
			expect(result.valid).toBe(false);
		});

		it('期限切れトークンでvalid: false', async () => {
			const loginResult = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			// 期限を過去に設定
			const pastDate = new Date(Date.now() - 1000).toISOString();
			testDb
				.insert(schema.settings)
				.values({ key: 'session_expires_at', value: pastDate })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { value: pastDate },
				})
				.run();

			const result = await validateSession(loginResult.sessionToken, 'test-tenant');
			expect(result.valid).toBe(false);
		});

		it('リフレッシュ閾値以下でrefreshed: true', async () => {
			const loginResult = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			// 残り10日に設定（閾値は30日）
			const nearExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
			testDb
				.insert(schema.settings)
				.values({ key: 'session_expires_at', value: nearExpiry })
				.onConflictDoUpdate({
					target: schema.settings.key,
					set: { value: nearExpiry },
				})
				.run();

			const result = await validateSession(loginResult.sessionToken, 'test-tenant');
			expect(result).toEqual({ valid: true, refreshed: true });
		});

		it('十分な残り期間ではrefreshed: false', async () => {
			const loginResult = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			const result = await validateSession(loginResult.sessionToken, 'test-tenant');
			expect(result).toEqual({ valid: true, refreshed: false });
		});
	});

	// --- logout ---
	describe('logout', () => {
		it('セッショントークンがクリアされる', async () => {
			await login(TEST_PIN, 'test-tenant');
			await logout('test-tenant');
			const token = await getSetting('session_token', 'test-tenant');
			expect(token).toBe('');
		});

		it('ログアウト後のトークンは無効', async () => {
			const loginResult = assertSuccess(await login(TEST_PIN, 'test-tenant'));
			await logout('test-tenant');
			const result = await validateSession(loginResult.sessionToken, 'test-tenant');
			expect(result.valid).toBe(false);
		});
	});

	// --- setupPin ---
	describe('setupPin', () => {
		it('PINハッシュが保存される', async () => {
			await setupPin('5678', 'test-tenant');
			const hash = await getSetting('pin_hash', 'test-tenant');
			expect(hash).toBeDefined();
			expect(hash).not.toBe('');
			expect(bcrypt.compareSync('5678', hash ?? '')).toBe(true);
		});

		it('新しいPINでログインできる', async () => {
			await setupPin('5678', 'test-tenant');
			const result = await login('5678', 'test-tenant');
			expect('error' in result).toBe(false);
		});

		it('失敗カウントがリセットされる', async () => {
			// 失敗を蓄積
			await login('9999', 'test-tenant');
			await login('9999', 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('2');

			// PIN変更で失敗カウントリセット
			await setupPin('5678', 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('0');
		});
	});

	// --- verifyPin (#771) ---
	describe('verifyPin', () => {
		it('正しいPINでok: true', async () => {
			const result = await verifyPin(TEST_PIN, 'test-tenant');
			expect(result).toEqual({ ok: true });
		});

		it('正しいPINでもセッショントークンは発行されない', async () => {
			// login と異なり、検証のみでセッションは作られない
			await verifyPin(TEST_PIN, 'test-tenant');
			const token = await getSetting('session_token', 'test-tenant');
			expect(token).toBe('');
		});

		it('間違ったPINでINVALID_PIN', async () => {
			const result = await verifyPin('9999', 'test-tenant');
			expect(result).toEqual({ ok: false, error: 'INVALID_PIN' });
		});

		it('間違ったPINで失敗カウントが増加する', async () => {
			await verifyPin('9999', 'test-tenant');
			const attempts = await getSetting('pin_failed_attempts', 'test-tenant');
			expect(attempts).toBe('1');
		});

		// #1360: pin_hash 未設定時は DEFAULT_PIN (5086) でフォールバック
		it('pin_hash 未設定時はデフォルトおやカギコード 5086 でok: true', async () => {
			seedAuthSettings('');
			const result = await verifyPin(OYAKAGI_DEFAULT_PIN, 'test-tenant');
			expect(result).toEqual({ ok: true });
		});

		it('pin_hash 未設定時に 5086 以外は INVALID_PIN', async () => {
			seedAuthSettings('');
			const result = await verifyPin('1234', 'test-tenant');
			expect(result).toEqual({ ok: false, error: 'INVALID_PIN' });
		});

		it('5回失敗でロックアウト (login と共通のカウンタ)', async () => {
			for (let i = 0; i < 5; i++) {
				await verifyPin('9999', 'test-tenant');
			}
			const result = await verifyPin(TEST_PIN, 'test-tenant');
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('LOCKED_OUT');
			}
		});

		it('成功で失敗カウントがリセットされる', async () => {
			await verifyPin('9999', 'test-tenant');
			await verifyPin('9999', 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('2');

			await verifyPin(TEST_PIN, 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('0');
		});
	});

	// --- isPinConfigured (#771) ---
	describe('isPinConfigured', () => {
		it('PIN設定済みでtrue', async () => {
			expect(await isPinConfigured('test-tenant')).toBe(true);
		});

		it('PIN未設定でfalse', async () => {
			seedAuthSettings('');
			expect(await isPinConfigured('test-tenant')).toBe(false);
		});
	});
});
