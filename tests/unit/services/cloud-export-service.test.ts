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
	// #3504 非同期 build
	updateStatus: vi.fn(),
	findPendingBuilds: vi.fn().mockResolvedValue([]),
	// #3509 QM 是正: stale 'building' reclaim
	findStaleBuildingExports: vi.fn().mockResolvedValue([]),
};

const mockStorageRepo = {
	saveFile: vi.fn(),
	readFile: vi.fn(),
	deleteByPrefix: vi.fn(),
	getDownloadUrl: vi.fn(),
};

const mockActivityRepo = {
	findActivities: vi.fn().mockResolvedValue([]),
};

// #2362 PR-3 (ADR-0055): per-child instance repo の mock
const mockChildActivityRepo = {
	findActivitiesByChild: vi.fn().mockResolvedValue([
		{
			name: '走る',
			categoryId: 1,
			icon: '🏃',
			basePoints: 5,
			triggerHint: null,
			isMainQuest: 0,
			priority: 'optional',
		},
	]),
};

const mockChildRepo = {
	findAllChildren: vi.fn().mockResolvedValue([{ id: 1, nickname: 'テスト' }]),
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
		childActivity: mockChildActivityRepo,
		child: mockChildRepo,
		checklist: mockChecklistRepo,
	}),
}));

// SUT
import {
	cleanupExpiredExports,
	consumeCloudExportDownload,
	createCloudExport,
	deleteCloudExport,
	drainPendingExports,
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
		mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([]);
		// #3504: 非同期 build mock を毎回リセット (clearAllMocks は実装を残すため override leak を防ぐ)
		mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);
		mockCloudExportRepo.updateStatus.mockResolvedValue(undefined);
		mockStorageRepo.saveFile.mockReset();
		mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
			id: 1,
			...input,
			downloadCount: 0,
			maxDownloads: (input.maxDownloads as number) ?? 10,
			createdAt: new Date().toISOString(),
		}));
		// #2362 PR-3 (ADR-0055): per-child child fixture + activity fixture
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: 1, nickname: 'テスト' }]);
		mockChildActivityRepo.findActivitiesByChild.mockResolvedValue([
			{
				name: '走る',
				categoryId: 1,
				icon: '🏃',
				basePoints: 5,
				triggerHint: null,
				isMainQuest: 0,
				priority: 'optional',
			},
		]);
	});

	describe('createCloudExport (#3504 async: pending 起票のみ)', () => {
		it('テンプレートエクスポートを pending で起票する (build しない)', async () => {
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});

			expect(result.pinCode).toHaveLength(6);
			expect(result.exportType).toBe('template');
			expect(typeof result.expiresAt).toBe('string');
			expect(result.expiresAt).not.toBe('');
			// 起票時点では build 前 → status pending / size 0 / description null
			expect(result.status).toBe('pending');
			expect(result.fileSizeBytes).toBe(0);
			expect(result.description).toBeNull();
			// insert は status='pending' で 1 回、saveFile は呼ばれない (build は cron)
			expect(mockCloudExportRepo.insert).toHaveBeenCalledOnce();
			expect(mockCloudExportRepo.insert.mock.calls[0]?.[0]).toMatchObject({ status: 'pending' });
			expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
		});

		it('s3Key の filename は exportType で決まる (template=data.json / full=backup.zip)', async () => {
			await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});
			expect(mockCloudExportRepo.insert.mock.calls[0]?.[0]?.s3Key).toMatch(/\/data\.json$/);
			vi.clearAllMocks();
			mockCloudExportRepo.countByTenant.mockResolvedValue(0);
			mockCloudExportRepo.findByPin.mockResolvedValue(null);
			mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
				id: 1,
				...input,
			}));
			await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'full',
				licenseStatus: 'active',
			});
			expect(mockCloudExportRepo.insert.mock.calls[0]?.[0]?.s3Key).toMatch(/\/backup\.zip$/);
		});

		it('ローカルモードでも起票できる (#3504 §3.5: NUC でも cloud export 可)', async () => {
			mockAuthMode = 'local';
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});
			expect(result.status).toBe('pending');
			expect(mockCloudExportRepo.insert).toHaveBeenCalledOnce();
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

	describe('drainPendingExports (#3504 async: 背景 build)', () => {
		function pendingRecord(overrides: Record<string, unknown> = {}) {
			return {
				id: 1,
				tenantId: 'tenant-1',
				exportType: 'template',
				pinCode: 'ABC234',
				s3Key: 'exports/tenant-1/ABC234/data.json',
				status: 'pending',
				...overrides,
			};
		}

		it('pending を build して building→ready に遷移し saveFile する', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

			const result = await drainPendingExports(5);

			expect(result).toEqual({ processed: 1, ready: 1, failed: 0, reclaimed: 0 });
			// building → ready の 2 回
			expect(mockCloudExportRepo.updateStatus).toHaveBeenNthCalledWith(
				1,
				1,
				'tenant-1',
				'building',
			);
			const readyCall = mockCloudExportRepo.updateStatus.mock.calls[1];
			expect(readyCall?.[2]).toBe('ready');
			expect((readyCall?.[3] as { fileSizeBytes: number }).fileSizeBytes).toBeGreaterThan(0);
			expect((readyCall?.[3] as { description: string }).description).toContain('活動');
			expect(mockStorageRepo.saveFile).toHaveBeenCalledOnce();
		});

		it('template build は child 別 shape (activitiesByChild) を出力する (#2362 PR-3、PO 判断 A 案)', async () => {
			mockChildRepo.findAllChildren.mockResolvedValue([
				{ id: 10, nickname: 'たろう' },
				{ id: 20, nickname: 'はなこ' },
			]);
			mockChildActivityRepo.findActivitiesByChild
				.mockResolvedValueOnce([
					{
						name: 'はしる',
						categoryId: 1,
						icon: '🏃',
						basePoints: 5,
						triggerHint: null,
						isMainQuest: 1,
						priority: 'must',
					},
				])
				.mockResolvedValueOnce([
					{
						name: 'よむ',
						categoryId: 2,
						icon: '📖',
						basePoints: 3,
						triggerHint: '寝る前',
						isMainQuest: 0,
						priority: 'optional',
					},
				]);
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

			await drainPendingExports();

			const savedCall = mockStorageRepo.saveFile.mock.calls[0];
			expect(savedCall).toBeDefined();
			const savedData = JSON.parse((savedCall?.[1] as Buffer).toString('utf-8'));
			expect(savedData.format).toBe('ganbari-quest-template');
			expect(savedData.version).toBe('2.0.0');
			expect(savedData.activitiesByChild).toHaveLength(2);
			expect(savedData.activitiesByChild[0]).toMatchObject({
				childId: 10,
				childNickname: 'たろう',
				activities: [{ name: 'はしる', isMainQuest: 1, priority: 'must' }],
			});
			// 旧 family-wide shape は出力されない
			expect(savedData.activities).toBeUndefined();
		});

		it('full build は description に「フルバックアップ」を含めて ready 遷移する', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ exportType: 'full', s3Key: 'exports/tenant-1/ABC234/backup.zip' }),
			]);

			await drainPendingExports();

			const readyCall = mockCloudExportRepo.updateStatus.mock.calls[1];
			expect(readyCall?.[2]).toBe('ready');
			expect((readyCall?.[3] as { description: string }).description).toContain('フルバックアップ');
		});

		it('build 失敗時は failed + failureReason を記録し他は継続する', async () => {
			mockStorageRepo.saveFile.mockRejectedValueOnce(new Error('disk full'));
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: 1 }),
				pendingRecord({ id: 2 }),
			]);

			const result = await drainPendingExports();

			expect(result.failed).toBe(1);
			expect(result.ready).toBe(1);
			// id=1 は failed 遷移 (building → failed) + failureReason
			const failedCall = mockCloudExportRepo.updateStatus.mock.calls.find((c) => c[2] === 'failed');
			expect(failedCall?.[0]).toBe(1);
			expect((failedCall?.[3] as { failureReason: string }).failureReason).toContain('disk full');
		});

		it('pending 0 件のとき何もしない', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);
			const result = await drainPendingExports();
			expect(result).toEqual({ processed: 0, ready: 0, failed: 0, reclaimed: 0 });
			expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
		});

		it('#3509 QM 是正: stale building を pending へ reclaim してから drain する', async () => {
			mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([
				pendingRecord({ id: 99, status: 'building' }),
			]);
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);

			const result = await drainPendingExports();

			expect(result.reclaimed).toBe(1);
			expect(mockCloudExportRepo.updateStatus).toHaveBeenCalledWith(99, 'tenant-1', 'pending');
		});

		it('#3509 QM 是正: stale building が無ければ reclaim 0 で通常 drain する', async () => {
			mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([]);
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

			const result = await drainPendingExports();

			expect(result.reclaimed).toBe(0);
			expect(result.ready).toBe(1);
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

		it('#3504: pending/building/failed も (期限内なら) 生成状況として返す', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			const past = new Date();
			past.setDate(past.getDate() - 1);

			mockCloudExportRepo.findByTenant.mockResolvedValue([
				// pending: DL 上限に関係なく表示
				{
					id: 1,
					expiresAt: future.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
					status: 'pending',
				},
				// building: 表示
				{
					id: 2,
					expiresAt: future.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
					status: 'building',
				},
				// failed: 表示
				{
					id: 3,
					expiresAt: future.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
					status: 'failed',
				},
				// ready かつ DL 上限到達: 除外
				{
					id: 4,
					expiresAt: future.toISOString(),
					downloadCount: 10,
					maxDownloads: 10,
					status: 'ready',
				},
				// 期限切れ pending: 除外
				{
					id: 5,
					expiresAt: past.toISOString(),
					downloadCount: 0,
					maxDownloads: 10,
					status: 'pending',
				},
				// status 未設定 (旧行) は ready 扱い: 表示
				{ id: 6, expiresAt: future.toISOString(), downloadCount: 0, maxDownloads: 10 },
			]);

			const ids = (await listCloudExports('tenant-1')).map((e) => e.id).sort();
			expect(ids).toEqual([1, 2, 3, 6]);
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
				tenantId: 'tenant-1',
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

			// #3376: data:string → bytes:Uint8Array に変更（full は ZIP バイナリ対応のため）
			expect(new TextDecoder().decode(result.bytes)).toBe('{"test":"data"}');
			// #3376 adversarial 是正: fetch は DL を消費しない (preview / validate 失敗で
			// maxDownloads を食い潰さないため)。消費は consumeCloudExportDownload に分離。
			expect(mockCloudExportRepo.incrementDownloadCount).not.toHaveBeenCalled();
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

	describe('consumeCloudExportDownload (#3376 adversarial)', () => {
		it('record.tenantId で tenant 束縛して DL カウントを 1 消費する (#2845 B1)', async () => {
			await consumeCloudExportDownload({
				id: 7,
				tenantId: 'tenant-1',
			} as unknown as Parameters<typeof consumeCloudExportDownload>[0]);

			expect(mockCloudExportRepo.incrementDownloadCount).toHaveBeenCalledWith(7, 'tenant-1');
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
