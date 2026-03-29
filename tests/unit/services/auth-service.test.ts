// tests/unit/services/auth-service.test.ts
// 認証サービスのユニットテスト

import bcrypt from 'bcrypt';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

const SQL_TABLES = `
	CREATE TABLE settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
`;

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
	login,
	logout,
	setupPin,
	validateSession,
} from '../../../src/lib/server/services/auth-service';

const DEFAULT_PIN = '1234';
let defaultPinHash: string;

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
	defaultPinHash = bcrypt.hashSync(DEFAULT_PIN, 10);
});

afterAll(() => {
	sqlite.close();
});

function seedAuthSettings(pinHash: string = defaultPinHash) {
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
			const result = await login(DEFAULT_PIN, 'test-tenant');
			expect('error' in result).toBe(false);
			if (!('error' in result)) {
				expect(result.sessionToken).toBeDefined();
				expect(result.sessionToken.length).toBeGreaterThan(0);
				expect(result.expiresAt).toBeDefined();
			}
		});

		it('ログイン成功後にsettingsにセッションが保存される', async () => {
			const result = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in result)) {
				const storedToken = await getSetting('session_token', 'test-tenant');
				expect(storedToken).toBe(result.sessionToken);
			}
		});

		it('間違ったPINでログイン失敗', async () => {
			const result = await login('9999', 'test-tenant');
			expect(result).toEqual({ error: 'INVALID_PIN' });
		});

		it('PIN未設定の場合はPIN_NOT_SET', async () => {
			seedAuthSettings('');
			const result = await login('1234', 'test-tenant');
			expect(result).toEqual({ error: 'PIN_NOT_SET' });
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
			const result = await login(DEFAULT_PIN, 'test-tenant');
			expect('error' in result).toBe(true);
			if ('error' in result) {
				expect(result.error).toBe('LOCKED_OUT');
			}
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

			const result = await login(DEFAULT_PIN, 'test-tenant');
			expect('error' in result).toBe(false);
		});

		it('ログイン成功で失敗カウントがリセットされる', async () => {
			// 3回失敗
			await login('9999', 'test-tenant');
			await login('9999', 'test-tenant');
			await login('9999', 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('3');

			// 正しいPINで成功
			await login(DEFAULT_PIN, 'test-tenant');
			expect(await getSetting('pin_failed_attempts', 'test-tenant')).toBe('0');
		});
	});

	// --- validateSession ---
	describe('validateSession', () => {
		it('有効なトークンでvalid: true', async () => {
			const loginResult = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in loginResult)) {
				const result = await validateSession(loginResult.sessionToken, 'test-tenant');
				expect(result.valid).toBe(true);
			}
		});

		it('不正なトークンでvalid: false', async () => {
			await login(DEFAULT_PIN, 'test-tenant');
			const result = await validateSession('invalid-token', 'test-tenant');
			expect(result.valid).toBe(false);
		});

		it('空トークンでvalid: false', async () => {
			const result = await validateSession('', 'test-tenant');
			expect(result.valid).toBe(false);
		});

		it('期限切れトークンでvalid: false', async () => {
			const loginResult = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in loginResult)) {
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
			}
		});

		it('リフレッシュ閾値以下でrefreshed: true', async () => {
			const loginResult = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in loginResult)) {
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
			}
		});

		it('十分な残り期間ではrefreshed: false', async () => {
			const loginResult = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in loginResult)) {
				const result = await validateSession(loginResult.sessionToken, 'test-tenant');
				expect(result).toEqual({ valid: true, refreshed: false });
			}
		});
	});

	// --- logout ---
	describe('logout', () => {
		it('セッショントークンがクリアされる', async () => {
			await login(DEFAULT_PIN, 'test-tenant');
			await logout('test-tenant');
			const token = await getSetting('session_token', 'test-tenant');
			expect(token).toBe('');
		});

		it('ログアウト後のトークンは無効', async () => {
			const loginResult = await login(DEFAULT_PIN, 'test-tenant');
			if (!('error' in loginResult)) {
				await logout('test-tenant');
				const result = await validateSession(loginResult.sessionToken, 'test-tenant');
				expect(result.valid).toBe(false);
			}
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
});
