// tests/unit/services/cloud-export-service.test.ts
// クラウドエクスポートサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asCategoryId, asChildId } from '$lib/domain/ids';
import { SETTINGS_LABELS } from '$lib/domain/labels';
import { MAX_SERVER_MESSAGE_LENGTH } from '$lib/ui/error-notify';

// テスト用グローバル制御変数
let mockAuthMode = 'cognito';
let mockPlanTier = 'standard';

// モック: logger
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// モック: auth factory
// #4723: モード判定の実体は auth-mode.ts (factory は re-export)。plan-limit-service など
// 直接 auth-mode を import する側にも同じ値が見えるよう、両方を差し替える。
vi.mock('$lib/server/auth/auth-mode', () => ({
	getAuthMode: () => mockAuthMode,
}));

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
vi.mock('$lib/server/services/export-service', () => {
	const sampleExportData = {
		format: 'ganbari-quest-backup',
		version: '1.1.0',
		checksum: 'sha256:test',
		family: { children: [{ id: '1', nickname: 'テスト' }] },
		data: {
			activityLogs: [{ id: '1' }, { id: '2' }],
		},
	};
	return {
		exportFamilyData: vi.fn(async () => sampleExportData),
		// #3518-1: full export build は checksum 計算と data.json を使い回す exportFamilyDataForZip を使う。
		exportFamilyDataForZip: vi.fn(async () => ({
			exportData: sampleExportData,
			dataJson: JSON.stringify(sampleExportData),
		})),
	};
});

// モック: repos
const mockCloudExportRepo = {
	findByPin: vi.fn().mockResolvedValue(null),
	findByTenant: vi.fn().mockResolvedValue([]),
	findById: vi.fn(),
	insert: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
		id: '1',
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
	// #3522 dual-cron 楽観ロック: pending→building CAS claim (既定は claim 成功)
	claimForBuild: vi.fn().mockResolvedValue(true),
	// #3509 QM 是正: stale 'building' reclaim
	findStaleBuildingExports: vi.fn().mockResolvedValue([]),
};

const mockStorageRepo = {
	saveFile: vi.fn(),
	readFile: vi.fn(),
	deleteByPrefix: vi.fn(),
	// #4724: エクスポート ZIP は完全 PII のため全バージョンごと消す (purgeByPrefix)
	purgeByPrefix: vi.fn(),
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
			categoryId: asCategoryId(1),
			icon: '🏃',
			basePoints: 5,
			triggerHint: null,
			isMainQuest: 0,
			priority: 'optional',
		},
	]),
};

const mockChildRepo = {
	findAllChildren: vi.fn().mockResolvedValue([{ id: '1', nickname: 'テスト' }]),
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
	CloudExportPlanGateError,
	CloudExportQuotaError,
	cleanupExpiredExports,
	consumeCloudExportDownload,
	createCloudExport,
	deleteCloudExport,
	drainPendingExports,
	fetchCloudExportByPin,
	listCloudExports,
	previewPendingExports,
} from '$lib/server/services/cloud-export-service';

/**
 * reject された error を **その型のまま** 取り出す。
 *
 * `promise.catch((e: unknown) => e as X)` は解決値との union (`X | CloudExportResult`) を返すため、
 * 続く `err.requiredTier` 等が型エラーになる (svelte-check は warning=error なので CI が落ちる)。
 * `as X` を `.catch` の外に出しても、それは「reject しなかった」場合を静かに通す点で危うい
 * (解決値に対して `undefined` を assert することになり、失敗の理由が読めない)。
 *
 * ここでは **実際に reject したこと** と **その class であること** を検査してから narrow する。
 * 型を通すためだけの cast ではなく、assertion がひとつ増えている。
 */
async function rejectionOf<T extends Error>(
	promise: Promise<unknown>,
	ctor: new (...args: never[]) => T,
): Promise<T> {
	try {
		await promise;
	} catch (e) {
		expect(e).toBeInstanceOf(ctor);
		return e as T;
	}
	throw new Error(`${ctor.name} で reject するはずが解決した`);
}

describe('cloud-export-service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthMode = 'cognito';
		mockPlanTier = 'standard';
		mockCloudExportRepo.countByTenant.mockResolvedValue(0);
		mockCloudExportRepo.findByTenant.mockResolvedValue([]);
		mockCloudExportRepo.findByPin.mockResolvedValue(null);
		mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([]);
		// #3504: 非同期 build mock を毎回リセット (clearAllMocks は実装を残すため override leak を防ぐ)
		mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);
		mockCloudExportRepo.updateStatus.mockResolvedValue(undefined);
		// #3522: claim は既定成功 (二重取得の contended ケースは個別 test で false 上書き)
		mockCloudExportRepo.claimForBuild.mockResolvedValue(true);
		mockStorageRepo.saveFile.mockReset();
		mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
			id: '1',
			...input,
			downloadCount: 0,
			maxDownloads: (input.maxDownloads as number) ?? 10,
			createdAt: new Date().toISOString(),
		}));
		// #2362 PR-3 (ADR-0055): per-child child fixture + activity fixture
		mockChildRepo.findAllChildren.mockResolvedValue([{ id: '1', nickname: 'テスト' }]);
		mockChildActivityRepo.findActivitiesByChild.mockResolvedValue([
			{
				name: '走る',
				categoryId: asCategoryId(1),
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
			mockCloudExportRepo.findByTenant.mockResolvedValue([]);
			mockCloudExportRepo.findByPin.mockResolvedValue(null);
			mockCloudExportRepo.insert.mockImplementation(async (input: Record<string, unknown>) => ({
				id: '1',
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

		// #4710: プラン未達と保管上限は **別の型** で throw する。両方を素の Error にすると
		// 呼び出し元は message の部分一致で見分けるしかなくなり、契約済みの顧客にも
		// 「スタンダード以上でご利用いただけます」と案内してしまう。
		it('無料プランは CloudExportPlanGateError (プラン未達)', async () => {
			mockPlanTier = 'free';

			await expect(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'none',
				}),
			).rejects.toBeInstanceOf(CloudExportPlanGateError);
		});

		it('プラン未達の案内はアップグレード先 tier を言う', async () => {
			mockPlanTier = 'free';
			const err = await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'none',
				}),
				CloudExportPlanGateError,
			);

			expect(err.requiredTier).toBe('standard');
			expect(err.message).toContain('スタンダードプラン以上');
		});

		it('保管数上限は CloudExportQuotaError (プラン未達ではない)', async () => {
			// #4767 (QM): 保管数は live 行 (listCloudExports と同じ述語) で数える
			mockCloudExportRepo.findByTenant.mockResolvedValue(
				Array.from({ length: 3 }, (_, i) => ({
					id: `live-${i}`,
					tenantId: 'tenant-1',
					pinCode: `00000${i}`,
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-09-01T00:00:00.000Z',
					downloadCount: 0,
					maxDownloads: 3,
					status: 'ready',
				})),
			);

			const promise = createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});
			await expect(promise).rejects.toBeInstanceOf(CloudExportQuotaError);
			await expect(promise).rejects.not.toBeInstanceOf(CloudExportPlanGateError);
		});

		it('保管数上限の案内は削除を促し、アップグレードを求めない (#4710)', async () => {
			// #4767 (QM): 保管数は live 行 (listCloudExports と同じ述語) で数える
			mockCloudExportRepo.findByTenant.mockResolvedValue(
				Array.from({ length: 3 }, (_, i) => ({
					id: `live-${i}`,
					tenantId: 'tenant-1',
					pinCode: `00000${i}`,
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-09-01T00:00:00.000Z',
					downloadCount: 0,
					maxDownloads: 3,
					status: 'ready',
				})),
			);
			const err = await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
				CloudExportQuotaError,
			);

			expect(err.current).toBe(3);
			expect(err.max).toBe(3);
			expect(err.message).toContain('削除');
			// standard で契約済みの顧客にプラン案内をしない (これが #4710 の症状)
			expect(err.message).not.toContain('スタンダードプラン以上');
			expect(err.message).not.toContain('アップグレード');
		});

		it('family (最上位) でも保管上限に達しうる — 上げ先が無いのでプラン案内は誤り (#4710)', async () => {
			mockPlanTier = 'family';
			mockCloudExportRepo.findByTenant.mockResolvedValue(
				Array.from({ length: 10 }, (_, i) => ({
					id: `live-${i}`,
					tenantId: 'tenant-1',
					pinCode: `00000${i}`,
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-09-01T00:00:00.000Z',
					downloadCount: 0,
					maxDownloads: 3,
					status: 'ready',
				})),
			);

			const err = await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
				CloudExportQuotaError,
			);

			expect(err.max).toBe(10);
			expect(err.message).not.toContain('アップグレード');
		});

		it('上限のエラーは「どれを消せばいいか」を名指しする (失敗 → 使い切り → 作成が古い順、#4767 PO 回答 #3)', async () => {
			mockCloudExportRepo.findByTenant.mockResolvedValue([
				// 取り出せる行 (新しい) — 候補としては最後
				{
					id: 'live',
					tenantId: 'tenant-1',
					pinCode: 'AAA222',
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-09-02T00:00:00.000Z',
					downloadCount: 0,
					maxDownloads: 3,
					status: 'ready',
				},
				// DL 回数を使い切った行 — 2 番目
				{
					id: 'exhausted',
					tenantId: 'tenant-1',
					pinCode: 'BBB333',
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-09-01T00:00:00.000Z',
					downloadCount: 3,
					maxDownloads: 3,
					status: 'ready',
				},
				// build 失敗行 — 最優先の候補
				{
					id: 'failed',
					tenantId: 'tenant-1',
					pinCode: 'CCC444',
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: '2026-08-31T00:00:00.000Z',
					downloadCount: 0,
					maxDownloads: 3,
					status: 'failed',
				},
			]);

			const err = await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
				CloudExportQuotaError,
			);

			// 消す候補が PIN で名指しされ、失敗 → 使い切り → 残りの順に並ぶ
			expect(err.candidates.map((c) => c.pinCode)).toEqual(['CCC444', 'BBB333', 'AAA222']);
			for (const pin of ['CCC444', 'BBB333', 'AAA222']) {
				expect(err.message).toContain(pin);
			}
			// 状態も文言に出る (何が起きている行なのかが分かる)
			expect(err.message).toContain(SETTINGS_LABELS.cloudRowStateFailed);
			expect(err.message).toContain(SETTINGS_LABELS.cloudRowStateExhausted);
			// 契約済みの顧客にプラン案内をしない (#4710 の症状の回帰固定)
			expect(err.message).not.toContain('アップグレード');
		});

		it('上限のエラーに載せる候補は 3 件までに絞る (画面側の 200 字上限で切れないため、#4767)', async () => {
			mockCloudExportRepo.findByTenant.mockResolvedValue(
				Array.from({ length: 10 }, (_, i) => ({
					id: `live-${i}`,
					tenantId: 'tenant-1',
					pinCode: `P0000${i}`,
					expiresAt: '2999-01-01T00:00:00.000Z',
					createdAt: `2026-08-2${i}T00:00:00.000Z`,
					downloadCount: 0,
					maxDownloads: 3,
					status: 'ready',
				})),
			);
			mockPlanTier = 'family';

			const err = await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
				CloudExportQuotaError,
			);

			expect(err.candidates).toHaveLength(3);
			expect(err.message.length).toBeLessThanOrEqual(MAX_SERVER_MESSAGE_LENGTH);
		});

		it('削除で枠が空けば次の起票が通る (削除 → 即座に枠が戻る、#4767 PO 回答 #3)', async () => {
			const full = Array.from({ length: 3 }, (_, i) => ({
				id: `live-${i}`,
				tenantId: 'tenant-1',
				pinCode: `00000${i}`,
				expiresAt: '2999-01-01T00:00:00.000Z',
				createdAt: '2026-09-01T00:00:00.000Z',
				downloadCount: 3,
				maxDownloads: 3,
				status: 'ready',
			}));
			// 1 回目: 3 / 3 で埋まっているので 403 相当の quota error
			mockCloudExportRepo.findByTenant.mockResolvedValueOnce(full);
			await rejectionOf(
				createCloudExport({
					tenantId: 'tenant-1',
					exportType: 'template',
					licenseStatus: 'active',
				}),
				CloudExportQuotaError,
			);

			// 顧客が 1 件削除する
			mockCloudExportRepo.findById.mockResolvedValue({
				id: 'live-0',
				s3Key: 'exports/tenant-1/000000/data.json',
			});
			await deleteCloudExport('live-0', 'tenant-1');
			expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith('live-0', 'tenant-1');

			// 2 回目: 残り 2 件なので起票できる (枠が戻っている)
			mockCloudExportRepo.findByTenant.mockResolvedValueOnce(full.slice(1));
			const result = await createCloudExport({
				tenantId: 'tenant-1',
				exportType: 'template',
				licenseStatus: 'active',
			});
			expect(result.status).toBe('pending');
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
				id: '1',
				tenantId: 'tenant-1',
				exportType: 'template',
				pinCode: 'ABC234',
				s3Key: 'exports/tenant-1/ABC234/data.json',
				status: 'pending',
				...overrides,
			};
		}

		// #4373: dryRun は「今どれだけ滞留しているか」を build せずに確かめるモードなので、
		// 件数フィールドが定数であってはならない (grace-period の tenantsRemaining と同 class)。
		describe('#4373 previewPendingExports (dryRun の件数は実測値)', () => {
			it('pending 件数を実測して返す (定数 0 ではない)', async () => {
				mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
					pendingRecord({ id: '1' }),
					pendingRecord({ id: '2' }),
				]);

				const result = await previewPendingExports(5);

				expect(result.processed).toBe(2);
				expect(mockCloudExportRepo.findPendingBuilds).toHaveBeenCalledWith(5);
			});

			it('pending が無ければ 0 を返す', async () => {
				mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);

				expect((await previewPendingExports(5)).processed).toBe(0);
			});

			it('回帰: 1 件も build せず status も書き換えない', async () => {
				mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

				await previewPendingExports(5);

				expect(mockCloudExportRepo.claimForBuild).not.toHaveBeenCalled();
				expect(mockCloudExportRepo.updateStatus).not.toHaveBeenCalled();
				expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
				// stale reclaim は write を伴うため dryRun では走らせない
				expect(mockCloudExportRepo.findStaleBuildingExports).not.toHaveBeenCalled();
			});
		});

		it('pending を build して building→ready に遷移し saveFile する', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

			const result = await drainPendingExports(5);

			expect(result).toEqual({ processed: 1, ready: 1, failed: 0, reclaimed: 0, skipped: 0 });
			// #3522: building 遷移は claimForBuild (CAS) が担う。updateStatus は ready 遷移の 1 回のみ。
			expect(mockCloudExportRepo.claimForBuild).toHaveBeenCalledWith('1', 'tenant-1');
			const readyCall = mockCloudExportRepo.updateStatus.mock.calls[0];
			expect(readyCall?.[2]).toBe('ready');
			expect((readyCall?.[3] as { fileSizeBytes: number }).fileSizeBytes).toBeGreaterThan(0);
			expect((readyCall?.[3] as { description: string }).description).toContain('活動');
			expect(mockStorageRepo.saveFile).toHaveBeenCalledOnce();
		});

		it('template build は child 別 shape (activitiesByChild) を出力する (#2362 PR-3、PO 判断 A 案)', async () => {
			mockChildRepo.findAllChildren.mockResolvedValue([
				{ id: '10', nickname: 'たろう' },
				{ id: '20', nickname: 'はなこ' },
			]);
			mockChildActivityRepo.findActivitiesByChild
				.mockResolvedValueOnce([
					{
						name: 'はしる',
						categoryId: asCategoryId(1),
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
						categoryId: asCategoryId(2),
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
				childId: asChildId(10),
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

			// #3522: building 遷移は claimForBuild が担うため updateStatus の 1 回目が ready。
			const readyCall = mockCloudExportRepo.updateStatus.mock.calls[0];
			expect(readyCall?.[2]).toBe('ready');
			expect((readyCall?.[3] as { description: string }).description).toContain('フルバックアップ');
		});

		it('build 失敗時は failed + failureReason を記録し他は継続する', async () => {
			mockStorageRepo.saveFile.mockRejectedValueOnce(new Error('disk full'));
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: '1' }),
				pendingRecord({ id: '2' }),
			]);

			const result = await drainPendingExports();

			expect(result.failed).toBe(1);
			expect(result.ready).toBe(1);
			// id=1 は failed 遷移 (building → failed) + failureReason
			const failedCall = mockCloudExportRepo.updateStatus.mock.calls.find((c) => c[2] === 'failed');
			expect(failedCall?.[0]).toBe('1');
			expect((failedCall?.[3] as { failureReason: string }).failureReason).toContain('disk full');
		});

		it('pending 0 件のとき何もしない', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);
			const result = await drainPendingExports();
			expect(result).toEqual({ processed: 0, ready: 0, failed: 0, reclaimed: 0, skipped: 0 });
			expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
		});

		it('#3509 QM 是正 (async-backup-export.md §3.2-4): stale building を failed へ fail-closed してから drain する', async () => {
			mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([
				pendingRecord({ id: '99', status: 'building' }),
			]);
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([]);

			const result = await drainPendingExports();

			expect(result.reclaimed).toBe(1);
			expect(mockCloudExportRepo.updateStatus).toHaveBeenCalledWith(
				'99',
				'tenant-1',
				'failed',
				expect.objectContaining({
					failureReason: expect.stringContaining('タイムアウト'),
				}),
			);
		});

		it('#3509 QM 是正: stale building が無ければ reclaim 0 で通常 drain する', async () => {
			mockCloudExportRepo.findStaleBuildingExports.mockResolvedValue([]);
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([pendingRecord()]);

			const result = await drainPendingExports();

			expect(result.reclaimed).toBe(0);
			expect(result.ready).toBe(1);
		});

		it('#3695: 時間予算超過で残件を build せず skipped として持ち越す (pending のまま残す)', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: '1' }),
				pendingRecord({ id: '2' }),
				pendingRecord({ id: '3' }),
			]);
			// 1 件目の build 後に予算超過する fake budget (2 回目の exceeded() から true)
			let calls = 0;
			const budget = { exceeded: () => ++calls > 1, elapsedMs: () => 20_001 };

			const result = await drainPendingExports(5, budget);

			expect(result).toEqual({ processed: 1, ready: 1, failed: 0, reclaimed: 0, skipped: 2 });
			// #3522: 2 件目以降は claim すらせず pending のまま (次回 cron が拾う)。claim は id=1 のみ。
			const claimedIds = mockCloudExportRepo.claimForBuild.mock.calls.map((c) => c[0]);
			expect(claimedIds).toEqual(['1']);
		});

		it('#3695: 開始時点で予算超過なら 1 件も build せず全件持ち越す', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: '1' }),
				pendingRecord({ id: '2' }),
			]);
			const budget = { exceeded: () => true, elapsedMs: () => 20_001 };

			const result = await drainPendingExports(5, budget);

			expect(result).toEqual({ processed: 0, ready: 0, failed: 0, reclaimed: 0, skipped: 2 });
			expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
		});

		it('#3522: claim に失敗した (別 worker が先取得) レコードは二重 build せず skip する', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: '1' }),
				pendingRecord({ id: '2' }),
			]);
			// id=1 は別 worker が先に claim 済み (false)、id=2 は自分が claim 成功 (true)
			mockCloudExportRepo.claimForBuild.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

			const result = await drainPendingExports(5);

			// contended (id=1) は attempted に数えず build もしない。id=2 のみ build して ready。
			expect(result).toEqual({ processed: 1, ready: 1, failed: 0, reclaimed: 0, skipped: 0 });
			// claim は 2 件とも試みる (先取得判定のため)。build (saveFile) は claim 成功の 1 件のみ。
			expect(mockCloudExportRepo.claimForBuild).toHaveBeenCalledTimes(2);
			expect(mockStorageRepo.saveFile).toHaveBeenCalledOnce();
			// contended レコード (id=1) に対して build 系の updateStatus (ready/failed) は発火しない。
			const touchedIds = mockCloudExportRepo.updateStatus.mock.calls.map((c) => c[0]);
			expect(touchedIds).not.toContain('1');
		});

		it('#3522: 全件 claim 敗退なら 1 件も build しない (二重実行防止)', async () => {
			mockCloudExportRepo.findPendingBuilds.mockResolvedValue([
				pendingRecord({ id: '1' }),
				pendingRecord({ id: '2' }),
			]);
			mockCloudExportRepo.claimForBuild.mockResolvedValue(false);

			const result = await drainPendingExports(5);

			expect(result).toEqual({ processed: 0, ready: 0, failed: 0, reclaimed: 0, skipped: 0 });
			expect(mockStorageRepo.saveFile).not.toHaveBeenCalled();
		});
	});

	describe('listCloudExports (#4767 PO 回答 #3: 枠を占有している全行を状態付きで返す)', () => {
		/** 期限内 (枠を占有) の行を作る。 */
		function row(over: Record<string, unknown>) {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			return {
				id: 'x',
				tenantId: 'tenant-1',
				pinCode: 'ABC234',
				expiresAt: future.toISOString(),
				createdAt: '2026-09-01T00:00:00.000Z',
				downloadCount: 0,
				maxDownloads: 10,
				status: 'ready',
				...over,
			};
		}

		it('期限切れだけを除外し、DL 使い切り / 失敗も枠を占有する行として返す', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 1);
			mockCloudExportRepo.findByTenant.mockResolvedValue([
				row({ id: '1' }),
				// 期限切れ: 枠を占有しないので除外 (cleanup 済み扱い)
				row({ id: '2', expiresAt: past.toISOString() }),
				// DL 回数を使い切った行: S3 に PII ZIP が残るので枠を占有する = 一覧に出して消せるようにする
				row({ id: '3', downloadCount: 10 }),
			]);

			const result = await listCloudExports('tenant-1');

			expect(result.map((e) => e.id).sort()).toEqual(['1', '3']);
			expect(result.find((e) => e.id === '1')?.rowState).toBe('downloadable');
			expect(result.find((e) => e.id === '3')?.rowState).toBe('exhausted');
		});

		it('全状態に表示用の rowState が付く (生成待ち / 生成中 / 失敗 / 使い切り / DL 可、旧行は ready 扱い)', async () => {
			const past = new Date();
			past.setDate(past.getDate() - 1);
			mockCloudExportRepo.findByTenant.mockResolvedValue([
				row({ id: '1', status: 'pending' }),
				row({ id: '2', status: 'building' }),
				row({ id: '3', status: 'failed' }),
				row({ id: '4', status: 'ready', downloadCount: 10 }),
				// 期限切れ pending: 除外
				row({ id: '5', status: 'pending', expiresAt: past.toISOString() }),
				// status 未設定 (旧行) は ready 扱い
				row({ id: '6', status: undefined }),
			]);

			const byId = new Map((await listCloudExports('tenant-1')).map((e) => [e.id, e.rowState]));

			expect([...byId.keys()].sort()).toEqual(['1', '2', '3', '4', '6']);
			expect(byId.get('1')).toBe('pending');
			expect(byId.get('2')).toBe('building');
			expect(byId.get('3')).toBe('failed');
			expect(byId.get('4')).toBe('exhausted');
			expect(byId.get('6')).toBe('downloadable');
		});

		it('自動削除までの残日数を JST 暦日で返す (プロセス TZ に依存しない)', async () => {
			mockCloudExportRepo.findByTenant.mockResolvedValue([
				row({ id: '1', expiresAt: '2026-09-10T00:00:00.000Z' }),
				row({ id: '2', expiresAt: '2026-09-04T00:00:00.000Z' }),
			]);

			// JST 2026-09-03 12:00 (= UTC 03:00) 時点で判定する
			const result = await listCloudExports('tenant-1', new Date('2026-09-03T03:00:00.000Z'));

			expect(result.find((e) => e.id === '1')?.daysUntilAutoDelete).toBe(7);
			expect(result.find((e) => e.id === '2')?.daysUntilAutoDelete).toBe(1);
		});
	});

	describe('deleteCloudExport', () => {
		it('存在するエクスポートを削除できる', async () => {
			mockCloudExportRepo.findById.mockResolvedValue({
				id: '1',
				s3Key: 'exports/tenant-1/ABC123/data.json',
			});

			await deleteCloudExport('1', 'tenant-1');

			expect(mockStorageRepo.purgeByPrefix).toHaveBeenCalledWith(
				'exports/tenant-1/ABC123/data.json',
			);
			expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith('1', 'tenant-1');
		});

		it('存在しないエクスポートの削除はエラーになる', async () => {
			mockCloudExportRepo.findById.mockResolvedValue(null);

			await expect(deleteCloudExport('999', 'tenant-1')).rejects.toThrow('見つかりません');
		});

		it('S3削除失敗はログのみで続行する', async () => {
			mockCloudExportRepo.findById.mockResolvedValue({
				id: '1',
				s3Key: 'exports/tenant-1/ABC123/data.json',
			});
			mockStorageRepo.purgeByPrefix.mockRejectedValue(new Error('S3 error'));

			await deleteCloudExport('1', 'tenant-1');

			// DB側の削除は実行される
			expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith('1', 'tenant-1');
		});
	});

	describe('fetchCloudExportByPin', () => {
		it('有効なPINでデータを取得できる', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: '1',
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
				id: '1',
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
				id: '1',
				expiresAt: future.toISOString(),
				downloadCount: 10,
				maxDownloads: 10,
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toThrow('ダウンロード');
		});

		// #4717: 非同期 build (#3504) の完了前 / 失敗時に取り込もうとしたときの分類。
		// AWS の build cron は 5 分毎なので、発行〜5 分は必ず pending / building に当たる。
		it('生成待ち (pending) の PIN は not-ready として分類される (500 に落とさない)', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: '1',
				tenantId: 'tenant-1',
				pinCode: 'ABC123',
				expiresAt: future.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
				s3Key: 'exports/tenant-1/ABC123/data.json',
				status: 'pending',
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toMatchObject({
				name: 'CloudExportFetchError',
				reason: 'not-ready',
			});
			// 生成待ちの判定は S3 read より前に行う (存在しない object を読みにいかない)
			expect(mockStorageRepo.readFile).not.toHaveBeenCalled();
		});

		it('生成中 (building) の PIN も not-ready として分類される', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: '1',
				expiresAt: future.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
				status: 'building',
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toMatchObject({
				reason: 'not-ready',
			});
		});

		it('生成に失敗した (failed) PIN は build-failed として分類される', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: '1',
				expiresAt: future.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
				status: 'failed',
			});

			await expect(fetchCloudExportByPin('ABC123')).rejects.toMatchObject({
				reason: 'build-failed',
			});
		});

		it('生成完了 (ready) の PIN は従来どおり取得できる', async () => {
			const future = new Date();
			future.setDate(future.getDate() + 3);
			mockCloudExportRepo.findByPin.mockResolvedValue({
				id: '1',
				tenantId: 'tenant-1',
				expiresAt: future.toISOString(),
				downloadCount: 0,
				maxDownloads: 10,
				s3Key: 'exports/tenant-1/ABC123/data.json',
				status: 'ready',
			});
			mockStorageRepo.readFile.mockResolvedValue({
				data: Buffer.from('{"test":"data"}'),
				contentType: 'application/json',
			});

			const result = await fetchCloudExportByPin('ABC123');
			expect(new TextDecoder().decode(result.bytes)).toBe('{"test":"data"}');
		});

		it('失敗理由は型で運ばれる (route が message の文字列 match に戻らないこと)', async () => {
			mockCloudExportRepo.findByPin.mockResolvedValue(null);
			await expect(fetchCloudExportByPin('NOPE')).rejects.toMatchObject({
				reason: 'invalid-pin',
			});
		});
	});

	describe('consumeCloudExportDownload (#3376 adversarial)', () => {
		it('record.tenantId で tenant 束縛して DL カウントを 1 消費する (#2845 B1)', async () => {
			await consumeCloudExportDownload({
				id: '7',
				tenantId: 'tenant-1',
			} as unknown as Parameters<typeof consumeCloudExportDownload>[0]);

			expect(mockCloudExportRepo.incrementDownloadCount).toHaveBeenCalledWith('7', 'tenant-1');
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
