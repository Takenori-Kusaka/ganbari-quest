// tests/unit/services/license-key-service.test.ts
// ライセンスキー生成・検証・消費サービスのユニットテスト (#0247, #319 HMAC署名対応)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック定義 ---
const mockSaveLicenseKey = vi.fn();
const mockFindLicenseKey = vi.fn();
const mockUpdateLicenseKeyStatus = vi.fn();
const mockUpdateTenantStripe = vi.fn();
const mockRevokeLicenseKey = vi.fn();
const mockLicenseEventInsert = vi.fn();
const mockLicenseEventFindByKey = vi.fn();
const mockLicenseEventFindRecent = vi.fn();
const mockLicenseEventCountFailures = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			saveLicenseKey: (...args: unknown[]) => mockSaveLicenseKey(...args),
			findLicenseKey: (...args: unknown[]) => mockFindLicenseKey(...args),
			updateLicenseKeyStatus: (...args: unknown[]) => mockUpdateLicenseKeyStatus(...args),
			updateTenantStripe: (...args: unknown[]) => mockUpdateTenantStripe(...args),
			revokeLicenseKey: (...args: unknown[]) => mockRevokeLicenseKey(...args),
		},
		licenseEvent: {
			insert: (...args: unknown[]) => mockLicenseEventInsert(...args),
			findByLicenseKey: (...args: unknown[]) => mockLicenseEventFindByKey(...args),
			findRecent: (...args: unknown[]) => mockLicenseEventFindRecent(...args),
			countRecentFailuresByIp: (...args: unknown[]) => mockLicenseEventCountFailures(...args),
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
	revokeLicenseKey,
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

	// --- #801: kind / issuedBy ---

	it('kind を省略した場合は purchase 扱いで保存される (後方互換)', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-default',
			plan: 'monthly',
		});

		expect(result.kind).toBe('purchase');
		expect(mockSaveLicenseKey).toHaveBeenCalledWith(expect.objectContaining({ kind: 'purchase' }));
	});

	it('kind=purchase + issuedBy を指定して発行できる (Stripe webhook 相当)', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-buyer',
			plan: 'monthly',
			kind: 'purchase',
			issuedBy: 'stripe:cs_test_123',
			stripeSessionId: 'cs_test_123',
		});

		expect(result.kind).toBe('purchase');
		expect(result.issuedBy).toBe('stripe:cs_test_123');
		expect(mockSaveLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'purchase',
				issuedBy: 'stripe:cs_test_123',
			}),
		);
	});

	it('kind=gift は issuedBy がないと throw する (監査要件)', async () => {
		await expect(
			issueLicenseKey({
				tenantId: 'tenant-gift',
				plan: 'yearly',
				kind: 'gift',
			}),
		).rejects.toThrow(/issuedBy is required/);
		expect(mockSaveLicenseKey).not.toHaveBeenCalled();
	});

	it('kind=campaign は issuedBy がないと throw する (監査要件)', async () => {
		await expect(
			issueLicenseKey({
				tenantId: 'tenant-campaign',
				plan: 'monthly',
				kind: 'campaign',
			}),
		).rejects.toThrow(/issuedBy is required/);
		expect(mockSaveLicenseKey).not.toHaveBeenCalled();
	});

	it('kind=gift + issuedBy を指定して発行できる (Ops 経由相当)', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-gift',
			plan: 'yearly',
			kind: 'gift',
			issuedBy: 'ops:admin-user-1',
		});

		expect(result.kind).toBe('gift');
		expect(result.issuedBy).toBe('ops:admin-user-1');
	});

	it('kind=campaign + issuedBy を指定して発行できる (キャンペーン配布相当)', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-campaign-pool',
			plan: 'monthly',
			kind: 'campaign',
			issuedBy: 'ops:campaign-2026-spring',
		});

		expect(result.kind).toBe('campaign');
		expect(result.issuedBy).toBe('ops:campaign-2026-spring');
	});

	// --- #797: expiresAt ---

	it('expiresAt を省略した場合はデフォルト90日後が設定される', async () => {
		const before = Date.now();
		const result = await issueLicenseKey({
			tenantId: 'tenant-default-expiry',
			plan: 'monthly',
		});
		const after = Date.now();

		expect(result.expiresAt).toBeDefined();
		const expiresMs = new Date(result.expiresAt as string).getTime();
		const MS_PER_DAY = 24 * 60 * 60 * 1000;
		// 90 日後 ± 数秒 (テスト実行時間分の誤差)
		expect(expiresMs).toBeGreaterThanOrEqual(before + 90 * MS_PER_DAY);
		expect(expiresMs).toBeLessThanOrEqual(after + 90 * MS_PER_DAY);
	});

	it('expiresAt を明示的に指定した場合はその値が使われる', async () => {
		const customExpiry = '2027-01-01T00:00:00.000Z';
		const result = await issueLicenseKey({
			tenantId: 'tenant-custom-expiry',
			plan: 'yearly',
			expiresAt: customExpiry,
		});

		expect(result.expiresAt).toBe(customExpiry);
		expect(mockSaveLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({ expiresAt: customExpiry }),
		);
	});

	it('expiresAt=null を渡すと期限なし (lifetime 扱い)', async () => {
		const result = await issueLicenseKey({
			tenantId: 'tenant-lifetime',
			plan: 'lifetime',
			expiresAt: null,
			kind: 'gift',
			issuedBy: 'ops:admin-1',
		});

		expect(result.expiresAt).toBeUndefined();
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

	// --- #797: expiresAt ---

	it('期限切れのキーは invalid を返す (active でも expiresAt < now)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
			expiresAt: '2026-02-01T00:00:00Z', // 過去
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.reason).toBe('このライセンスキーは有効期限が切れています');
		}
	});

	it('未来の expiresAt を持つキーは valid を返す', async () => {
		const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'yearly',
			status: 'active',
			createdAt: new Date().toISOString(),
			expiresAt: oneYearLater,
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
	});

	it('expiresAt 未設定の legacy レコードは期限チェックをスキップして valid', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2020-01-01T00:00:00Z',
			// expiresAt なし (legacy)
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await validateLicenseKey('GQ-ABCD-EFGH-JKLM');

		expect(result.valid).toBe(true);
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
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');
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
			'tenant-issuer',
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
			'tenant-issuer',
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
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('family-monthly');
			const expiresMs = new Date(result.planExpiresAt ?? '').getTime();
			expect(expiresMs).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-issuer',
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
		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plan).toBe('lifetime');
			expect(result.planExpiresAt).toBeUndefined();
		}
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-issuer',
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

		await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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

		await expect(consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer')).rejects.toThrow(
			'DynamoDB tenant write failed',
		);
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('キーが見つからない場合は {ok:false} を返し tenant/license どちらも更新しない', async () => {
		mockFindLicenseKey.mockResolvedValue(undefined);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer');

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

		const result = await consumeLicenseKey('gq-wxyz-wxyz-wxyz', 'tenant-issuer');

		expect(result.ok).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-WXYZ-WXYZ-WXYZ');
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-issuer',
			expect.objectContaining({ licenseKey: 'GQ-WXYZ-WXYZ-WXYZ' }),
		);
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalledWith(
			'GQ-WXYZ-WXYZ-WXYZ',
			'consumed',
			'tenant-issuer',
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

		const result = await consumeLicenseKey('  GQ-ABCD-EFGH-JKLM  ', 'tenant-issuer');

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

		await expect(consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-issuer')).rejects.toThrow(
			'DynamoDB write failed',
		);
		// tenant 更新は既に成功している（順序どおり）
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
	});

	// --- #801: kind 別の consume 権限チェック ---

	it('kind=purchase のキーは buyer tenant でのみ consume 可能（自 tenant なら OK）', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-buyer',
			plan: 'monthly',
			status: 'active',
			kind: 'purchase',
			issuedBy: 'stripe:cs_test_123',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-buyer');

		expect(result.ok).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalled();
	});

	it('kind=purchase のキーを別 tenant で consume しようとすると拒否する (#801)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-buyer',
			plan: 'family-yearly',
			status: 'active',
			kind: 'purchase',
			issuedBy: 'stripe:cs_test_123',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-attacker');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('購入したアカウント');
		}
		// tenant/license どちらも更新されない（攻撃を完全に拒否）
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('旧レコード (kind 未設定) は purchase 扱い — 別 tenant での consume を拒否 (#801)', async () => {
		// 旧データ: #801 の追加前に作成された既存レコードには kind がない。
		// 後方互換のため 'purchase' として扱い、最も厳しい保護を適用する。
		const record: LicenseRecord = {
			licenseKey: 'GQ-LEGC-LEGC-LEGC',
			tenantId: 'tenant-old-buyer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2025-06-01T00:00:00Z',
			// kind 未設定
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-LEGC-LEGC-LEGC', 'tenant-different');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('購入したアカウント');
		}
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('旧レコード (kind 未設定) でも自 tenant の consume は成功する (後方互換)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-LEGC-LEGC-LEGC',
			tenantId: 'tenant-legacy',
			plan: 'monthly',
			status: 'active',
			createdAt: '2025-06-01T00:00:00Z',
			// kind 未設定
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-LEGC-LEGC-LEGC', 'tenant-legacy');

		expect(result.ok).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalled();
	});

	it('kind=gift のキーは任意 tenant で consume 可能 (#801)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-GIFT-GIFT-GIFT',
			tenantId: 'tenant-ops-pool',
			plan: 'yearly',
			status: 'active',
			kind: 'gift',
			issuedBy: 'ops:support-user-1',
			createdAt: '2026-03-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-GIFT-GIFT-GIFT', 'tenant-recipient');

		expect(result.ok).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-recipient',
			expect.objectContaining({ plan: 'yearly' }),
		);
	});

	it('kind=campaign のキーは任意 tenant で consume 可能 (#801)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-CAMP-CAMP-CAMP',
			tenantId: 'tenant-campaign-pool',
			plan: 'monthly',
			status: 'active',
			kind: 'campaign',
			issuedBy: 'ops:campaign-2026-spring',
			createdAt: '2026-03-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-CAMP-CAMP-CAMP', 'tenant-anyone');

		expect(result.ok).toBe(true);
		expect(mockUpdateTenantStripe).toHaveBeenCalledWith(
			'tenant-anyone',
			expect.objectContaining({ plan: 'monthly' }),
		);
	});

	// --- #797: expiresAt ---

	it('期限切れキーは consume を拒否する (#797)', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-EXPR-EXPR-EXPR',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
			expiresAt: '2026-02-01T00:00:00Z', // 過去
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-EXPR-EXPR-EXPR', 'tenant-1');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('有効期限');
		}
		expect(mockUpdateTenantStripe).not.toHaveBeenCalled();
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('未来の expiresAt を持つキーは consume 成功する (#797)', async () => {
		const oneYearLater = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
		const record: LicenseRecord = {
			licenseKey: 'GQ-FUTR-FUTR-FUTR',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: new Date().toISOString(),
			expiresAt: oneYearLater,
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-FUTR-FUTR-FUTR', 'tenant-1');

		expect(result.ok).toBe(true);
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

// ============================================================
// #797: revokeLicenseKey
// ============================================================

describe('revokeLicenseKey (#797)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('active なキーを revoke して repo を呼び出す', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ACTV-ACTV-ACTV',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);
		mockRevokeLicenseKey.mockResolvedValue(undefined);

		const result = await revokeLicenseKey({
			licenseKey: 'GQ-ACTV-ACTV-ACTV',
			reason: 'ops-manual',
			revokedBy: 'ops:admin-1',
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.licenseKey).toBe('GQ-ACTV-ACTV-ACTV');
			expect(result.revokedReason).toBe('ops-manual');
			expect(result.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		}
		expect(mockRevokeLicenseKey).toHaveBeenCalledTimes(1);
		expect(mockRevokeLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({
				licenseKey: 'GQ-ACTV-ACTV-ACTV',
				reason: 'ops-manual',
				revokedBy: 'ops:admin-1',
				revokedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			}),
		);
	});

	it('小文字入力を正規化して revoke する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-LOWR-LOWR-LOWR',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);
		mockRevokeLicenseKey.mockResolvedValue(undefined);

		const result = await revokeLicenseKey({
			licenseKey: '  gq-lowr-lowr-lowr  ',
			reason: 'leaked',
			revokedBy: 'system',
		});

		expect(result.ok).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-LOWR-LOWR-LOWR');
		expect(mockRevokeLicenseKey).toHaveBeenCalledWith(
			expect.objectContaining({
				licenseKey: 'GQ-LOWR-LOWR-LOWR',
				reason: 'leaked',
			}),
		);
	});

	it('存在しないキーはエラーを返す', async () => {
		mockFindLicenseKey.mockResolvedValue(undefined);

		const result = await revokeLicenseKey({
			licenseKey: 'GQ-NONE-NONE-NONE',
			reason: 'ops-manual',
			revokedBy: 'ops:admin-1',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('見つかりません');
		}
		expect(mockRevokeLicenseKey).not.toHaveBeenCalled();
	});

	it('既に revoked なキーは冪等にエラーを返し repo を呼ばない', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-REVD-REVD-REVD',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'revoked',
			createdAt: '2026-01-01T00:00:00Z',
			revokedAt: '2026-02-01T00:00:00Z',
			revokedReason: 'leaked',
			revokedBy: 'system',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await revokeLicenseKey({
			licenseKey: 'GQ-REVD-REVD-REVD',
			reason: 'ops-manual',
			revokedBy: 'ops:admin-1',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('無効化');
		}
		expect(mockRevokeLicenseKey).not.toHaveBeenCalled();
	});

	it('consumed 済みのキーは revoke できない', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-CONS-CONS-CONS',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'consumed',
			createdAt: '2026-01-01T00:00:00Z',
			consumedAt: '2026-02-01T00:00:00Z',
			consumedBy: 'tenant-1',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await revokeLicenseKey({
			licenseKey: 'GQ-CONS-CONS-CONS',
			reason: 'ops-manual',
			revokedBy: 'ops:admin-1',
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain('使用');
		}
		expect(mockRevokeLicenseKey).not.toHaveBeenCalled();
	});

	it('revoke 後の validateLicenseKey は invalid を返す', async () => {
		// revoke 実行
		const activeRecord: LicenseRecord = {
			licenseKey: 'GQ-FLOW-FLOW-FLOW',
			tenantId: 'tenant-1',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValueOnce(activeRecord);
		mockRevokeLicenseKey.mockResolvedValue(undefined);

		const revokeResult = await revokeLicenseKey({
			licenseKey: 'GQ-FLOW-FLOW-FLOW',
			reason: 'leaked',
			revokedBy: 'ops:admin-1',
		});
		expect(revokeResult.ok).toBe(true);

		// 次に validate 呼び出し時には revoked 状態で返す
		const revokedRecord: LicenseRecord = {
			...activeRecord,
			status: 'revoked',
			revokedAt: new Date().toISOString(),
			revokedReason: 'leaked',
			revokedBy: 'ops:admin-1',
		};
		mockFindLicenseKey.mockResolvedValueOnce(revokedRecord);

		const validateResult = await validateLicenseKey('GQ-FLOW-FLOW-FLOW');

		expect(validateResult.valid).toBe(false);
		if (!validateResult.valid) {
			expect(validateResult.reason).toContain('無効');
		}
	});
});

// ============================================================
// #804: ライセンスキー監査ログ (license_events) の記録
// ============================================================

describe('ライセンスキー監査ログ記録 (#804)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSaveLicenseKey.mockResolvedValue(undefined);
		mockUpdateLicenseKeyStatus.mockResolvedValue(undefined);
		mockUpdateTenantStripe.mockResolvedValue(undefined);
		mockRevokeLicenseKey.mockResolvedValue(undefined);
		mockLicenseEventInsert.mockResolvedValue(undefined);
		process.env.AWS_LICENSE_SECRET = '';
	});

	afterEach(() => {
		process.env.AWS_LICENSE_SECRET = '';
	});

	describe('issueLicenseKey', () => {
		it('Stripe webhook 経由の発行で issued イベントを記録する', async () => {
			const result = await issueLicenseKey({
				tenantId: 'tenant-issue-1',
				plan: 'monthly',
				stripeSessionId: 'cs_test_evt',
			});

			expect(mockLicenseEventInsert).toHaveBeenCalledTimes(1);
			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('issued');
			expect(call.licenseKey).toBe(result.licenseKey);
			expect(call.tenantId).toBe('tenant-issue-1');
			expect(call.actorId).toBe('stripe:cs_test_evt');
			expect(call.metadata.plan).toBe('monthly');
			expect(call.metadata.kind).toBe('purchase');
			expect(call.metadata.stripeSessionId).toBe('cs_test_evt');
		});

		it('gift キーの発行で actorId に issuedBy を記録する', async () => {
			await issueLicenseKey({
				tenantId: 'tenant-gift',
				plan: 'lifetime',
				kind: 'gift',
				issuedBy: 'ops:admin-1',
				expiresAt: null,
			});

			expect(mockLicenseEventInsert).toHaveBeenCalledTimes(1);
			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('issued');
			expect(call.actorId).toBe('ops:admin-1');
			expect(call.metadata.kind).toBe('gift');
			expect(call.metadata.expiresAt).toBeNull();
		});

		it('context (ip/ua) を渡すと監査ログに保存される', async () => {
			await issueLicenseKey({
				tenantId: 'tenant-ctx',
				plan: 'yearly',
				kind: 'campaign',
				issuedBy: 'ops:admin-2',
				context: { ip: '203.0.113.5', ua: 'ops-cli/1.0' },
			});

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.ip).toBe('203.0.113.5');
			expect(call.ua).toBe('ops-cli/1.0');
		});
	});

	describe('validateLicenseKey', () => {
		it('形式不正 → validation_failed (prefix のみ、reason=format_invalid)', async () => {
			const result = await validateLicenseKey('INVALID-KEY');
			expect(result.valid).toBe(false);

			expect(mockLicenseEventInsert).toHaveBeenCalledTimes(1);
			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validation_failed');
			expect(call.licenseKey.length).toBeLessThanOrEqual(11); // prefix + '...'
			expect(call.metadata.reason).toBe('format_invalid');
		});

		it('存在しないキー → validation_failed (prefix, reason=not_found)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce(null);
			await validateLicenseKey('GQ-AAAA-BBBB-CCCC');

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validation_failed');
			expect(call.licenseKey).toContain('...'); // prefix + '...'
			expect(call.metadata.reason).toBe('not_found');
		});

		it('consumed キー → validation_failed (full key, reason=already_consumed)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-x',
				plan: 'monthly',
				status: 'consumed',
				createdAt: '2026-01-01T00:00:00Z',
			} satisfies LicenseRecord);

			await validateLicenseKey('GQ-AAAA-BBBB-CCCC');

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validation_failed');
			expect(call.licenseKey).toBe('GQ-AAAA-BBBB-CCCC'); // full key
			expect(call.metadata.reason).toBe('already_consumed');
			expect(call.metadata.issuedFor).toBe('tenant-x');
		});

		it('署名不一致 → validation_failed (reason=signature_mismatch)', async () => {
			process.env.AWS_LICENSE_SECRET = TEST_SECRET;
			// 署名なし payload に適当な 5 文字を付与 → 署名不一致になる
			await validateLicenseKey('GQ-ABCD-EFGH-JKLM-ZZZZZ');

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validation_failed');
			expect(call.metadata.reason).toBe('signature_mismatch');
		});

		it('成功時 → validated イベントを記録', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-ok',
				plan: 'yearly',
				status: 'active',
				createdAt: '2026-01-01T00:00:00Z',
			} satisfies LicenseRecord);

			const result = await validateLicenseKey('GQ-AAAA-BBBB-CCCC', {
				ip: '198.51.100.1',
				ua: 'ua-test',
			});
			expect(result.valid).toBe(true);

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validated');
			expect(call.licenseKey).toBe('GQ-AAAA-BBBB-CCCC');
			expect(call.tenantId).toBe('tenant-ok');
			expect(call.ip).toBe('198.51.100.1');
			expect(call.ua).toBe('ua-test');
			expect(call.metadata.plan).toBe('yearly');
			expect(call.metadata.kind).toBe('purchase');
		});

		it('期限切れ → validation_failed (reason=expired, expiresAt が metadata に入る)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-exp',
				plan: 'monthly',
				status: 'active',
				createdAt: '2024-01-01T00:00:00Z',
				expiresAt: '2024-02-01T00:00:00Z',
			} satisfies LicenseRecord);

			await validateLicenseKey('GQ-AAAA-BBBB-CCCC');

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('validation_failed');
			expect(call.metadata.reason).toBe('expired');
			expect(call.metadata.expiresAt).toBe('2024-02-01T00:00:00Z');
		});
	});

	describe('consumeLicenseKey', () => {
		it('成功時 → consumed イベント (actorId=tenant:<id>, plan/kind/planExpiresAt を metadata)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-buyer',
				plan: 'monthly',
				status: 'active',
				createdAt: '2026-01-01T00:00:00Z',
			} satisfies LicenseRecord);

			const result = await consumeLicenseKey('GQ-AAAA-BBBB-CCCC', 'tenant-buyer', {
				ip: '203.0.113.9',
				ua: 'browser',
			});
			expect(result.ok).toBe(true);

			expect(mockLicenseEventInsert).toHaveBeenCalledTimes(1);
			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('consumed');
			expect(call.actorId).toBe('tenant:tenant-buyer');
			expect(call.ip).toBe('203.0.113.9');
			expect(call.metadata.plan).toBe('monthly');
			expect(call.metadata.kind).toBe('purchase');
			expect(call.metadata.planExpiresAt).toBeTruthy();
		});

		it('cross-tenant 試行 → consume_failed (reason=cross_tenant_purchase, issuedFor 記録)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-buyer',
				plan: 'monthly',
				status: 'active',
				createdAt: '2026-01-01T00:00:00Z',
			} satisfies LicenseRecord);

			const result = await consumeLicenseKey('GQ-AAAA-BBBB-CCCC', 'tenant-attacker');
			expect(result.ok).toBe(false);

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('consume_failed');
			expect(call.actorId).toBe('tenant:tenant-attacker');
			expect(call.metadata.reason).toBe('cross_tenant_purchase');
			expect(call.metadata.issuedFor).toBe('tenant-buyer');
		});

		it('存在しないキー → consume_failed (prefix のみ)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce(null);

			await consumeLicenseKey('GQ-ZZZZ-YYYY-XXXX', 'tenant-x');

			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('consume_failed');
			expect(call.licenseKey).toContain('...');
			expect(call.metadata.reason).toBe('not_found');
		});
	});

	describe('revokeLicenseKey', () => {
		it('成功時 → revoked イベント (actorId=revokedBy, reason/plan/kind を metadata)', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-rev',
				plan: 'yearly',
				status: 'active',
				createdAt: '2026-01-01T00:00:00Z',
			} satisfies LicenseRecord);

			await revokeLicenseKey({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				reason: 'leaked',
				revokedBy: 'ops:admin-9',
				context: { ip: '198.51.100.9', ua: 'ops' },
			});

			expect(mockLicenseEventInsert).toHaveBeenCalledTimes(1);
			const call = mockLicenseEventInsert.mock.calls[0]![0]!;
			expect(call.eventType).toBe('revoked');
			expect(call.actorId).toBe('ops:admin-9');
			expect(call.tenantId).toBe('tenant-rev');
			expect(call.ip).toBe('198.51.100.9');
			expect(call.metadata.reason).toBe('leaked');
			expect(call.metadata.plan).toBe('yearly');
			expect(call.metadata.kind).toBe('purchase');
		});

		it('既に revoked 済みのキーは revoked イベントを記録しない', async () => {
			mockFindLicenseKey.mockResolvedValueOnce({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				tenantId: 'tenant-rev',
				plan: 'yearly',
				status: 'revoked',
				createdAt: '2026-01-01T00:00:00Z',
				revokedAt: '2026-02-01T00:00:00Z',
				revokedReason: 'ops-manual',
				revokedBy: 'ops:admin-1',
			} satisfies LicenseRecord);

			const result = await revokeLicenseKey({
				licenseKey: 'GQ-AAAA-BBBB-CCCC',
				reason: 'leaked',
				revokedBy: 'ops:admin-2',
			});

			expect(result.ok).toBe(false);
			expect(mockLicenseEventInsert).not.toHaveBeenCalled();
		});
	});

	it('監査ログ insert が throw しても本体処理は完走する (エラー分離)', async () => {
		mockLicenseEventInsert.mockRejectedValueOnce(new Error('db down'));
		const result = await issueLicenseKey({
			tenantId: 'tenant-err',
			plan: 'monthly',
		});
		expect(result.status).toBe('active');
		expect(mockSaveLicenseKey).toHaveBeenCalledTimes(1);
	});
});
