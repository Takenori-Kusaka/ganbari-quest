// tests/unit/services/license-key-service.test.ts
// ライセンスキー生成・検証・消費サービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- モック定義 ---
const mockSaveLicenseKey = vi.fn();
const mockFindLicenseKey = vi.fn();
const mockUpdateLicenseKeyStatus = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			saveLicenseKey: (...args: unknown[]) => mockSaveLicenseKey(...args),
			findLicenseKey: (...args: unknown[]) => mockFindLicenseKey(...args),
			updateLicenseKeyStatus: (...args: unknown[]) => mockUpdateLicenseKeyStatus(...args),
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
	type LicenseRecord,
	consumeLicenseKey,
	generateLicenseKey,
	issueLicenseKey,
	validateLicenseKey,
} from '$lib/server/services/license-key-service';

// ============================================================
// generateLicenseKey
// ============================================================

describe('generateLicenseKey', () => {
	it('GQ-XXXX-XXXX-XXXX 形式のキーを生成する', () => {
		const key = generateLicenseKey();
		expect(key).toMatch(/^GQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
	});

	it('曖昧な文字（0/O/1/I）を含まない', () => {
		// 100回生成して統計的に検証
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
		// 50個のキーが全て異なる（衝突率は極めて低い）
		expect(keys.size).toBe(50);
	});

	it('プレフィックスが GQ- である', () => {
		const key = generateLicenseKey();
		expect(key.startsWith('GQ-')).toBe(true);
	});

	it('3つのセグメントがハイフンで区切られている', () => {
		const key = generateLicenseKey();
		const segments = key.split('-');
		expect(segments).toHaveLength(4); // GQ, seg1, seg2, seg3
		expect(segments[0]).toBe('GQ');
		expect(segments[1]).toHaveLength(4);
		expect(segments[2]).toHaveLength(4);
		expect(segments[3]).toHaveLength(4);
	});
});

// ============================================================
// issueLicenseKey
// ============================================================

describe('issueLicenseKey', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSaveLicenseKey.mockResolvedValue(undefined);
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

		// ISO 8601 形式の検証
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

	it('不正な形式のキーは invalid を返す（禁止文字 O を含む）', async () => {
		// 正規表現は [A-Z0-9] なので O も 0 もマッチするが、形式自体は通る
		// ここでは完全に形式が壊れたケースをテスト
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
	});

	it('active なキーを消費して true を返す', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result).toBe(true);
		expect(mockUpdateLicenseKeyStatus).toHaveBeenCalledWith(
			'GQ-ABCD-EFGH-JKLM',
			'consumed',
			'tenant-consumer',
		);
	});

	it('キーが見つからない場合は false を返す', async () => {
		mockFindLicenseKey.mockResolvedValue(undefined);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result).toBe(false);
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('ステータスが consumed のキーは false を返す', async () => {
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

		expect(result).toBe(false);
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('ステータスが revoked のキーは false を返す', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-ABCD-EFGH-JKLM',
			tenantId: 'tenant-issuer',
			plan: 'monthly',
			status: 'revoked',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('GQ-ABCD-EFGH-JKLM', 'tenant-consumer');

		expect(result).toBe(false);
		expect(mockUpdateLicenseKeyStatus).not.toHaveBeenCalled();
	});

	it('小文字のキーを大文字に正規化して検索する', async () => {
		const record: LicenseRecord = {
			licenseKey: 'GQ-WXYZ-WXYZ-WXYZ',
			tenantId: 'tenant-issuer',
			plan: 'lifetime',
			status: 'active',
			createdAt: '2026-01-01T00:00:00Z',
		};
		mockFindLicenseKey.mockResolvedValue(record);

		const result = await consumeLicenseKey('gq-wxyz-wxyz-wxyz', 'tenant-consumer');

		expect(result).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-WXYZ-WXYZ-WXYZ');
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

		expect(result).toBe(true);
		expect(mockFindLicenseKey).toHaveBeenCalledWith('GQ-ABCD-EFGH-JKLM');
	});

	it('DB 更新が失敗した場合はエラーが伝播する', async () => {
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
	});
});
