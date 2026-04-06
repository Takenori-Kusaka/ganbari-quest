// tests/unit/services/cloud-export-service.test.ts
// クラウドエクスポートサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';

// テスト用グローバル制御変数
let mockAuthMode = 'cognito';
let mockPlanTier = 'standard';

// モック: logger
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// モック: auth factory
vi.mock('$lib/server/auth/factory', () => ({
	getAuthMode: () => mockAuthMode,
}));

// モック: plan-limit-service
vi.mock('$lib/server/services/plan-limit-service', () => ({
	resolveFullPlanTier: vi.fn(async () => mockPlanTier),
	getPlanLimits: vi.fn((tier: string) => {
		const limits: Record<string, { maxCloudExports: number }> = {
			free: { maxCloudExports: 0 },
			standard: { maxCloudExports: 3 },
			family: { maxCloudExports: 10 },
		};
		return limits[tier] ?? limits.free;
	}),
}));

// モック: export-service
vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: vi.fn(async () => ({
		format: 'ganbari-quest-backup',
		version: '1.1.0',
		family: { children: [{ id: 1, nickname: 'テスト' }] },
		data: {
			child_1: { activityLogs: [{ id: 1 }, { id: 2 }] },
		},
	})),
}));

// モック: repos
const mockCloudExportRepo = {
	findByPin: vi.fn().mockResolvedValue(null),
	findByTenant: vi.fn().mockResolvedValue([]),
	findById: vi.fn(),
	insert: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
		id: 1,
		...input,
		downloadCount: 0,
		maxDownloads: (input.maxDownloads as number) ?? 10,
		createdAt: new Date().toISOString(),
	})),
	incrementDownloadCount: vi.fn(),
	deleteById: vi.fn(),
	deleteExpired: vi.fn(),
	countByTenant: vi.fn().mockResolvedValue(0),
};

const mockStorageRepo = {
	saveFile: vi.fn(),
	readFile: vi.fn(),
	deleteByPrefix: vi.fn(),
};

const mockActivityRepo = {
	findActivities: vi.fn().mockResolvedValue([
		{
			name: '走る',
			categoryId: 1,
			icon: '🏃',
			basePoints: 5,
			ageMin: null,
			ageMax: null,
			triggerHint: null,
		},
	]),
};

const mockChildRepo = {
	findAllChildren: vi.fn().mockResolvedValue([]),
};

const mockChecklistRepo = {
	findTemplatesByChild: vi.fn().mockResolvedValue([]),
	findTemplateItems: vi.fn().mockResolvedValue([]),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		cloudExport: mockCloudExportRepo,
		storage: mockStorageRepo,
		activity: mockActivityRepo,
		child: mockChildRepo,
		checklist: mockChecklistRepo,
	}),
}));

// SUT
import {
	cleanupExpiredExports,
	createCloudExport,
	deleteCloudExport,
	fetchCloudExportByPin,
	listCloudExports,
} from '$lib/server/services/cloud-export-service';

describe('cloud-export-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthMode = 'cognito';
		mockPlanTier = 'standard';
		mockCloudExportRepo.countByTenant.mockResolvedValue(0);
		mockCloudExportRepo.findByPin.mockResolvedValue(null);
		mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
			id: 1,
			...input,
			downloadCount: 0,
			maxDownloads: (input.maxDownloads as number) ?? 10,
			createdAt: new Date().toISOString(),
		}));
	});

	describe('createCloudExport', () => {
		it('テンプレートエクスポートを作成できる', async () => {
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});

			expect(result.pinCode).toHaveLength(6);
			expect(result.exportType).toBe('template');
			expect(result.expiresAt).toBeTruthy();
			expect(result.fileSizeBytes).toBeGreaterThan(0);
			expect(mockStorageRepo.saveFile).toHaveBeenCalledOnce();
			expect(mockCloudExportRepo.insert).toHaveBeenCalledOnce();
		});

		it('フルバックアップエクスポートを作成できる', async () => {
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'full',
				licenseStatus: 'active',
			});

			expect(result.exportType).toBe('full');
			expect(result.description).toContain('フルバックアップ');
		});

		it('ローカルモードではエラーになる', async () => {
			mockAuthMode = 'local';

			await expect(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
			).rejects.toThrow('SaaS版でのみ利用可能');
		});

		it('無料プランではエラーになる', async () => {
			mockPlanTier = 'free';

			await expect(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'none',
				}),
			).rejects.toThrow('スタンダードプラン以上');
		});

		it('保管数上限に達している場合はエラーになる', async () => {
			mockCloudExportRepo.countByTenant.mockResolvedValue(3);

			await expect(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
			).rejects.toThrow('上限');
		});

		it('PINコードは6文字の英数字', async () => {
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});

			expect(result.pinCode).toMatch(/^[A-Z2-9]{6}$/);
		});
	});

	describe('listCloudExports', () => {
		it('有効なエクスポートのみ返す', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			const past = new Date();
			past.setDate(past.getDate() - 1);

			mockCloudExportRepo.findByTenant.mockResolvedValue([
				{
					id: 1,
					expiresAt: future.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
				},
				{
					id: 2,
					expiresAt: past.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
				},
				{
					id: 3,
					expiresAt: future.toISOString(),
					downloadCount: 10,
					maxDownloads: 10,
				},
			]);

			const result = await listCloudExports('tenant-1');

			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe(1);
		});
	});

	describe('deleteCloudExport', () => {
		it('存在するエクスポートを削除できる', async () => {
			mockCloudExportRepo.findById.mockResolvedValue({
				id: 1,
				s3Key: 'exports/tenant-1/ABC123/data.json',
			});

			await deleteCloudExport(1, 'tenant-1');

			expect(mockStorageRepo.deleteByPrefix).toHaveBeenCalledWith(
				'exports/tenant-1/ABC123/data.json',
			);
			expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith(1, 'tenant-1');
		});

		it('存在しないエクスポートの削除はエラーになる', async () => {
			mockCloudExportRepo.findById.mockResolvedValue(null);

			await expect(deleteCloudExport(999, 'tenant-1')).rejects.toThrow('見つかりません');
		});

		it('S3削除失敗はログのみで続行する', async () => {
			mockCloudExportRepo.findById.mockResolvedValue({
				id: 1,
				s3Key: 'exports/tenant-1/ABC123/data.json',
			});
			mockStorageRepo.deleteByPrefix.mockRejectedValue(new Error('S3 error'));

			await deleteCloudExport(1, 'tenant-1');

			// DB側の削除は実行される
			expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith(1, 'tenant-1');
		});
	});

	describe('fetchCloudExportByPin', () => {
		it('有効なPINでデータを取得できる', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: 1,
				pinCode: 'ABC123',
				expiresAt: future.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
				s3Key: 'exports/tenant-1/ABC123/data.json',
			});
			mockStorageRepo.readFile.mockResolvedValue({
				data: Buffer.from('{"test":"data"}'),
				contentType: 'application/json',
			});

			const result = await fetchCloudExportByPin('ABC123');

			expect(result.data).toBe('{"test":"data"}');
			expect(mockCloudExportRepo.incrementDownloadCount).toHaveBeenCalledWith(1);
		});

		it('PINは大文字に変換される', async () => {
			mockCloudExportRepo.findByPin.mockResolvedValue(null);

			await expect(fetchCloudExportByPin('abc123')).rejects.toThrow('PIN');
			expect(mockCloudExportRepo.findByPin).toHaveBeenCalledWith('ABC123');
		});

		it('無効なPINはエラーになる', async () => {
			mockCloudExportRepo.findByPin.mockResolvedValue(null);

			await expect(fetchCloudExportByPin('INVALID')).rejects.toThrow('PIN');
		});

		it('有効期限切れのPINはエラーになる', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 1);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: 1,
				expiresAt: past.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toThrow('有効期限');
		});

		it('DL回数上限のPINはエラーになる', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: 1,
				expiresAt: future.toISOString(),
				downloadCount: 10,
				maxDownloads: 10,
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toThrow('ダウンロード');
		});
	});

	describe('cleanupExpiredExports', () => {
		it('期限切れエクスポートを削除できる', async () => {
			mockCloudExportRepo.deleteExpired.mockResolvedValue(5);

			const count = await cleanupExpiredExports();

			expect(count).toBe(5);
			expect(mockCloudExportRepo.deleteExpired).toHaveBeenCalledOnce();
		});
	});
});
