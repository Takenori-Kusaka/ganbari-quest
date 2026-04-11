// tests/unit/services/license-key-service.test.ts
// ライセンスキー生成・検証・消費サービスのユニットテスト (#0247, #319 HMAC署名対応)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック定義 ---
const mockSaveLicenseKey = vi.fn();
const mockFindLicenseKey = vi.fn();
const mockUpdateLicenseKeyStatus = vi.fn();
const mockUpdateTenantStripe = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			saveLicenseKey: (...args: unknown[]) => mockSaveLicenseKey(...args),
			findLicenseKey: (...args: unknown[]) => mockFindLicenseKey(...args),
			updateLicenseKeyStatus: (...args: unknown[]) => mockUpdateLicenseKeyStatus(...args),
			updateTenantStripe: (...args: unknown[]) => mockUpdateTenantStripe(...args),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	assertLicenseKeyConfigured,
	consumeLicenseKey,
	createHmacChecksum,
	generateLicenseKey,
	isSignedKeyFormat,
	issueLicenseKey,
	type LicenseRecord,
	validateLicenseKey,
	verifyKeySignature,
} from '$lib/server/services/license-key-service';

const TEST_SECRET = 'test-license-secret-for-hmac-signing';

// ============================================================
// HMAC 署名ユーティリティ (#319)
// ============================================================

describe('createHmacChecksum', () => {
	it('5文字のチェックサムを生成する', () => {
		const checksum = createHmacChecksum('GQ-ABCD-EFGH-JKLM', TEST_SECRET);
		expect(checksum).toHaveLength(5);
		expect(checksum).toMatch(/^[A-Z0-9]{5}$/);
	});

	it('同じ入力に対して同じチェックサムを返す', () => {
		const a = createHmacChecksum('GQ-ABCD-EFGH-JKLM', TEST_SECRET);
		const b = createHmacChecksum('GQ-ABCD-EFGH-JKLM', TEST_SECRET);
		expect(a).toBe(b);
	});

	it('異なるペイロードで異なるチェックサムを返す', () => {
		const a = createHmacChecksum('GQ-ABCD-EFGH-JKLM', TEST_SECRET);
		const b = createHmacChecksum('GQ-WXYZ-WXYZ-WXYZ', TEST_SECRET);
		expect(a).not.toBe(b);
	});

	it('異なる秘密鍵で異なるチェックサムを返す', () => {
		const a = createHmacChecksum('GQ-ABCD-EFGH-JKLM', 'secret-1');
		const b = createHmacChecksum('GQ-ABCD-EFGH-JKLM', 'secret-2');
		expect(a).not.toBe(b);
	});

	it('曖昧な文字（0/O/1/I）を含まない', () => {
		for (let i = 0; i < 100; i++) {
			const checksum = createHmacChecksum(
				`GQ-TEST-${i.toString().padStart(4, '0')}-AAAA`,
				TEST_SECRET,
			);
			expect(checksum).not.toMatch(/[01OI]/);
		}
	});
});

describe('isSignedKeyFormat', () => {
	it('署名付き形式を判定する', () => {
		expect(isSignedKeyFormat('GQ-ABCD-EFGH-JKLM-NPRST')).toBe(true);
	});

	it('旧形式は false を返す', () => {
		expect(isSignedKeyFormat('GQ-ABCD-EFGH-JKLM')).toBe(false);
	});

	it('不正な形式は false を返す', () => {
		expect(isSignedKeyFormat('XX-ABCD-EFGH-JKLM-NPRST')).toBe(false);
		expect(isSignedKeyFormat('GQ-ABCD-EFGH-JKLM-NPR')).toBe(false);
		expect(isSignedKeyFormat('')).toBe(false);
	});
});

describe('verifyKeySignature', () => {
	it('正しい署名のキーを検証する', () => {
		const payload = 'GQ-ABCD-EFGH-JKLM';
		const checksum = createHmacChecksum(payload, TEST_SECRET);
		const key = `${payload}-${checksum}`;
		expect(verifyKeySignature(key, TEST_SECRET)).toBe(true);
	});

	it('不正な署名のキーを拒否する', () => {
		expect(verifyKeySignature('GQ-ABCD-EFGH-JKLM-ZZZZZ', TEST_SECRET)).toBe(false);
	});

	it('異なる秘密鍵で生成された署名を拒否する', () => {
		const payload = 'GQ-ABCD-EFGH-JKLM';
		const checksum = createHmacChecksum(payload, 'wrong-secret');
		const key = `${payload}-${checksum}`;
		expect(verifyKeySignature(key, TEST_SECRET)).toBe(false);
	});
});

// ============================================================
// generateLicenseKey
// ============================================================

describe('generateLicenseKey', () => {
	afterEach(() => {
		process.env.AWS_LICENSE_SECRET = '';
	});

	it('秘密鍵なしの場合 GQ-XXXX-XXXX-XXXX 形式のキーを生成する', () => {
		process.env.AWS_LICENSE_SECRET = '';
		const key = generateLicenseKey();
		expect(key).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
	});

	it('秘密鍵ありの場合 GQ-XXXX-XXXX-XXXX-YYYYY 形式のキーを生成する', () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		const key = generateLicenseKey();
		expect(key).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{5}$/);
	});

	it('署名付きキーの署名が正しく検証できる', () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		const key = generateLicenseKey();
		expect(verifyKeySignature(key, TEST_SECRET)).toBe(true);
	});

	it('曖昧な文字（0/O/1/I）を含まない', () => {
		for (let i = 0; i < 100; i++) {
			const key = generateLicenseKey();
			const body = key.slice(3); // "GQ-" を除去
			expect(body).not.toMatch(/[01OI]/);
		}
	});

	it('毎回異なるキーを生成する', () => {
		const keys = new Set<string>();
		for (let i = 0; i < 50; i++) {
			keys.add(generateLicenseKey());
		}
		expect(keys.size).toBe(50);
	});

	it('プレフィックスが GQ- である', () => {
		const key = generateLicenseKey();
		expect(key.startsWith('GQ-')).toBe(true);
	});

	it('秘密鍵なしの場合は3つのセグメントがハイフンで区切られている', () => {
		process.env.AWS_LICENSE_SECRET = '';
		const key = generateLicenseKey();
		const segments = key.split('-');
		expect(segments).toHaveLength(4); // GQ, seg1, seg2, seg3
		expect(segments[0]).toBe('GQ');
		expect(segments[1]).toHaveLength(4);
		expect(segments[2]).toHaveLength(4);
		expect(segments[3]).toHaveLength(4);
	});

	it('秘密鍵ありの場合は4つのセグメント+チェックサムがハイフンで区切られている', () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		const key = generateLicenseKey();
		const segments = key.split('-');
		expect(segments).toHaveLength(5); // GQ, seg1, seg2, seg3, checksum
		expect(segments[0]).toBe('GQ');
		expect(segments[1]).toHaveLength(4);
		expect(segments[2]).toHaveLength(4);
		expect(segments[3]).toHaveLength(4);
		expect(segments[4]).toHaveLength(5);
	});
});

// ============================================================
// issueLicenseKey
// ============================================================

describe('issueLicenseKey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSaveLicenseKey.mockResolvedValue(undefined);
		process.env.AWS_LICENSE_SECRET = '';
	});

	afterEach(() => {
		process.env.AWS_LICENSE_SECRET = '';
	});

	it('ライセンスレコードを生成して DB に保存する', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-1',
			plan: 'monthly',
		});

		expect(result.licenseKey).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
		expect(result.tenantId).toBe('tenant-1');
		expect(result.plan).toBe('monthly');
		expect(result.status).toBe('active');
		expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
		expect(mockSaveLicenseKey).toHaveBeenCalledTimes(1);
		expect(mockSaveLicenseKey).toHaveBeenCalledWith(result);
	});

	it('秘密鍵ありの場合は署名付きキーを発行する', async () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		const result = await issueLicenseKey({
			tenantId: 'tenant-signed',
			plan: 'monthly',
		});

		expect(result.licenseKey).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{5}$/);
		expect(verifyKeySignature(result.licenseKey, TEST_SECRET)).toBe(true);
	});

	it('yearly プランで発行できる', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-2',
			plan: 'yearly',
		});

		expect(result.plan).toBe('yearly');
		expect(result.status).toBe('active');
	});

	it('lifetime プランで発行できる', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-3',
			plan: 'lifetime',
		});

		expect(result.plan).toBe('lifetime');
	});

	it('stripeSessionId を指定できる', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-4',
			plan: 'monthly',
			stripeSessionId: 'cs_test_abc123',
		});

		expect(result.stripeSessionId).toBe('cs_test_abc123');
		expect(mockSaveLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({ stripeSessionId: 'cs_test_abc123' }),
		);
	});

	it('stripeSessionId を省略した場合はレコードに含まれない', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-5',
			plan: 'monthly',
		});

		expect(result.stripeSessionId).toBeUndefined();
	});

	it('createdAt が ISO 8601 形式の日時文字列である', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-6',
			plan: 'monthly',
		});

		const parsed = new Date(result.createdAt);
		expect(parsed.toISOString()).toBe(result.createdAt);
	});

	it('DB 保存が失敗した場合はエラーが伝播する', async () => {
		mockSaveLicenseKey.mockRejectedValue(new Error('DB connection error'));

		await expect(issueLicenseKey({ tenantId: 'tenant-err', plan: 'monthly' })).rejects.toThrow(
			'DB connection error',
		);
	});
});

// ============================================================
// validateLicenseKey
// ============================================================

describe('validateLicenseKey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.AWS_LICENSE_SECRET = '';
	});

	afterEach(() => {
		process.env.AWS_LICENSE_SECRET = '';
	});

	it('不正な形式のキーは invalid を返す（短すぎる）', async () => {
		const result = await validateLicenseKey('GQ-ABC');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーの形式が不正です');
		}
	});

	it('不正な形式のキーは invalid を返す（プレフィックスなし）', async () => {
		const result = await validateLicenseKey('XX-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーの形式が不正です');
		}
	});

	it('不正な形式のキーは invalid を返す（セグメント不足）', async () => {
		const result = await validateLicenseKey('GQ-ABCD-EFGH');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーの形式が不正です');
		}
	});

	it('不正な形式のキーは invalid を返す（空文字）', async () => {
		const result = await validateLicenseKey('');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーの形式が不正です');
		}
	});

	it('不正な形式のキーは invalid を返す（特殊文字を含む）', async () => {
		const result = await validateLicenseKey('GQ-AB!D-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーの形式が不正です');
		}
	});

	it('旧形式（署名なし）のキーも受け入れる', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
	});

	it('署名付きキーの署名が正しい場合はDBを参照する', async () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		const payload = 'GQ-ABCD-EFGH-JKLM';
		const checksum = createHmacChecksum(payload, TEST_SECRET);
		const signedKey = `${payload}-${checksum}`;

		const record: LicenseRecord = {
			licenseKey: signedKey,
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey(signedKey);

		expect(result.valid).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith(signedKey);
	});

	it('署名付きキーの署名が不正な場合はDB問い合わせなしで拒否する', async () => {
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM-ZZZZZ');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーが不正です');
		}
		expect(mockFindLicenseKey).not.toHaveBeenCalled();
	});

	it('秘密鍵未設定時は署名付きキーでもDB参照する（ローカルモード）', async () => {
		process.env.AWS_LICENSE_SECRET = '';
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM-NPRST',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM-NPRST');

		expect(result.valid).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalled();
	});

	it('小文字のキーを大文字に正規化して検証する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('gq-abcd-efgh-jklm');

		expect(result.valid).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-ABCD-EFGH-JKLM');
	});

	it('前後の空白を除去して検証する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('  GQ-ABCD-EFGH-JKLM  ');

		expect(result.valid).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-ABCD-EFGH-JKLM');
	});

	it('DB にキーが見つからない場合は invalid を返す', async () => {
		mockFindLicenseKey.mockResolvedValue(undefined);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーが見つかりません');
		}
	});

	it('ステータスが consumed のキーは invalid を返す', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'consumed',
			consumedBy: 'tenant-2',
			consumedAt: '2026-03-01T00:00:00Z',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('このライセンスキーは既に使用されています');
		}
	});

	it('ステータスが revoked のキーは invalid を返す', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'revoked',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('このライセンスキーは無効化されています');
		}
	});

	it('ステータスが active のキーは valid を返し、レコードを含む', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'yearly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.record).toEqual(record);
			expect(result.record.plan).toBe('yearly');
		}
	});
});

// ============================================================
// consumeLicenseKey
// ============================================================

describe('consumeLicenseKey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateLicenseKeyStatus.mockResolvedValue(undefined);
		mockUpdateTenantStripe.mockResolvedValue(undefined);
	});

	it('active な monthly キーを消費してテナントを active + 30日期限に昇格する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const before = Date.now();
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');
		const after = Date.now();

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('monthly');
			expect(result.planExpiresAt).toBeDefined();
			const expiresMs = new Date(result.planExpiresAt ?? '').getTime();
			// 30 日（±1秒の実行時間許容）
			expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
			expect(expiresMs).toBeLessThanOrEqual(after + 30 * 24 * 60 * 60 * 1000 + 100);
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-consumer',
			expect.objectContaining({
				plan: 'monthly',
				status: 'active',
				licenseKey: 'GQ-ABCD-EFGH-JKLM',
				planExpiresAt: expect.any(String),
			}),
		);
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalledWith(
			'GQ-ABCD-EFGH-JKLM',
			'consumed',
			'tenant-consumer',
		);
	});

	it('yearly キーは 365日期限を付与する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'yearly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const before = Date.now();
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('yearly');
			const expiresMs = new Date(result.planExpiresAt ?? '').getTime();
			expect(expiresMs).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 * 1000);
		}
	});

	it('family-monthly キーは monthly と同じ 30日期限で昇格する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'family-monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const before = Date.now();
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('family-monthly');
			const expiresMs = new Date(result.planExpiresAt ?? '').getTime();
			expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-consumer',
			expect.objectContaining({ plan: 'family-monthly' }),
		);
	});

	it('family-yearly キーは 365日期限で昇格する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'family-yearly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const before = Date.now();
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('family-yearly');
			const expiresMs = new Date(result.planExpiresAt ?? '').getTime();
			expect(expiresMs).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 * 1000);
		}
	});

	it('lifetime キーは planExpiresAt=undefined で昇格する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'lifetime',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('lifetime');
			expect(result.planExpiresAt).toBeUndefined();
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-consumer',
			expect.objectContaining({
				plan: 'lifetime',
				status: 'active',
				planExpiresAt: undefined,
			}),
		);
	});

	it('tenant plan 更新は license status 更新より先に呼ばれる (整合性担保)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		const tenantOrder = mockUpdateTenantStripe.mock.invocationCallOrder[0];
		const licenseOrder = mockUpdateLicenseKeyStatus.mock.invocationCallOrder[0];
		expect(tenantOrder).toBeDefined();
		expect(licenseOrder).toBeDefined();
		// tenant の plan 昇格が license consumed マークより必ず先
		expect(tenantOrder as number).toBeLessThan(licenseOrder as number);
	});

	it('tenant plan 更新が失敗した場合 license は consumed にならない', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);
		mockUpdateTenantStripe.mockRejectedValue(new Error('DynamoDB tenant write failed'));

		await expect(consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer')).rejects.toThrow(
			'DynamoDB tenant write failed',
		);
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('キーが見つからない場合は {ok:false} を返し tenant/license どちらも更新しない', async () => {
		mockFindLicenseKey.mockResolvedValue(undefined);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('ライセンスキーが見つかりません');
		}
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('ステータスが consumed のキーは {ok:false} を返し何も更新しない', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'consumed',
			consumedBy: 'tenant-other',
			consumedAt: '2026-02-01T00:00:00Z',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('このライセンスキーは既に使用されています');
		}
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('ステータスが revoked のキーは {ok:false} を返し何も更新しない', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'revoked',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('このライセンスキーは無効化されています');
		}
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('小文字のキーを大文字に正規化して検索・更新する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-WXYZ-WXYZ-WXYZ',
			tenantId: 'tenant-issuer',
			plan: 'lifetime',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('gq-wxyz-wxyz-wxyz', 'tenant-consumer');

		expect(result.ok).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-WXYZ-WXYZ-WXYZ');
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-consumer',
			expect.objectContaining({ licenseKey: 'GQ-WXYZ-WXYZ-WXYZ' }),
		);
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalledWith(
			'GQ-WXYZ-WXYZ-WXYZ',
			'consumed',
			'tenant-consumer',
		);
	});

	it('前後の空白を除去して正規化する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('  GQ-ABCD-EFGH-JKLM  ', 'tenant-consumer');

		expect(result.ok).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-ABCD-EFGH-JKLM');
	});

	it('license 更新 DB 書き込みが失敗した場合はエラーが伝播する (tenant 更新は成功済み)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);
		mockUpdateLicenseKeyStatus.mockRejectedValue(new Error('DynamoDB write failed'));

		await expect(consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer')).rejects.toThrow(
			'DynamoDB write failed',
		);
		// tenant 更新は既に成功している（順序どおり）
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
	});
});

// ============================================================
// #806: assertLicenseKeyConfigured / production legacy 拒否
// ============================================================

describe('assertLicenseKeyConfigured (#806)', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalSecret = process.env.AWS_LICENSE_SECRET;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		process.env.AWS_LICENSE_SECRET = originalSecret;
	});

	it('production + secret 未設定で throw する（誤デプロイ検知）', () => {
		process.env.NODE_ENV = 'production';
		process.env.AWS_LICENSE_SECRET = '';

		expect(() => assertLicenseKeyConfigured()).toThrow(/AWS_LICENSE_SECRET is required/);
	});

	it('production + secret 設定済みで throw しない', () => {
		process.env.NODE_ENV = 'production';
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;

		expect(() => assertLicenseKeyConfigured()).not.toThrow();
	});

	it('development + secret 未設定で throw しない（ローカル開発を壊さない）', () => {
		process.env.NODE_ENV = 'development';
		process.env.AWS_LICENSE_SECRET = '';

		expect(() => assertLicenseKeyConfigured()).not.toThrow();
	});

	it('test 環境 + secret 未設定で throw しない', () => {
		process.env.NODE_ENV = 'test';
		process.env.AWS_LICENSE_SECRET = '';

		expect(() => assertLicenseKeyConfigured()).not.toThrow();
	});
});

describe('validateLicenseKey legacy 形式の production 拒否 (#806)', () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalAllowLegacy = process.env.ALLOW_LEGACY_LICENSE_KEYS;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		if (originalAllowLegacy === undefined) {
			delete process.env.ALLOW_LEGACY_LICENSE_KEYS;
		} else {
			process.env.ALLOW_LEGACY_LICENSE_KEYS = originalAllowLegacy;
		}
		process.env.AWS_LICENSE_SECRET = '';
	});

	it('production では legacy 形式キーを DB 問い合わせなしで拒否する', async () => {
		process.env.NODE_ENV = 'production';
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		delete process.env.ALLOW_LEGACY_LICENSE_KEYS;

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('ライセンスキーが不正です');
		}
		expect(mockFindLicenseKey).not.toHaveBeenCalled();
	});

	it('production + ALLOW_LEGACY_LICENSE_KEYS=true では legacy 形式を受け入れる (移行期)', async () => {
		process.env.NODE_ENV = 'production';
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		process.env.ALLOW_LEGACY_LICENSE_KEYS = 'true';

		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-ABCD-EFGH-JKLM');
	});

	it('development では legacy 形式を引き続き受け入れる（既存開発フローを壊さない）', async () => {
		process.env.NODE_ENV = 'development';
		process.env.AWS_LICENSE_SECRET = '';
		delete process.env.ALLOW_LEGACY_LICENSE_KEYS;

		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
	});

	it('production でも署名付きキーは従来どおり受け入れる', async () => {
		process.env.NODE_ENV = 'production';
		process.env.AWS_LICENSE_SECRET = TEST_SECRET;
		delete process.env.ALLOW_LEGACY_LICENSE_KEYS;

		const payload = 'GQ-ABCD-EFGH-JKLM';
		const checksum = createHmacChecksum(payload, TEST_SECRET);
		const signedKey = `${payload}-${checksum}`;

		const record: LicenseRecord = {
			licenseKey: signedKey,
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey(signedKey);

		expect(result.valid).toBe(true);
	});
});
