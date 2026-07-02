// tests/unit/routes/import-cloud-template-per-child.test.ts
// #2362 PR-3 (ADR-0055): /api/v1/import/cloud のテンプレート取込 per-child instance 化検証
//
// 検証範囲:
//   - template export v2.0.0 (activitiesByChild shape) の preview / execute フロー
//   - execute 時に targetChildIds 必須化 (ChildSelectionDialog 経由)
//   - cross-tenant child id 拒否 (CWE-639 IDOR 排除)
//   - 同名 activity の per-child dedup
//   - 旧 version 1.0.0 (family-wide shape) は拒否される
//
// 関連:
//   - cloud-export-service.buildTemplateExportData (v2.0.0 出力)
//   - ADR-0055 §3.1 (childId 必須化、cross-child access 防止)

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks (top-level)
const mockFetchCloudExport = vi.fn();
// #3376 adversarial: DL 消費は consumeCloudExportDownload に分離されたため spy を持つ。
const mockConsumeDownload = vi.fn();
// #3376: fetchCloudExportByPin は { record, bytes } を返すようになったため、
// テスト fixture も JSON を Uint8Array (bytes) に encode して与える。
const enc = (s: string) => new TextEncoder().encode(s);
const mockFindAllChildren = vi.fn();
const mockFindActivitiesByChild = vi.fn();
const mockInsertActivitiesBulk = vi.fn();

vi.mock('$lib/server/auth/factory', () => ({
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/services/cloud-export-service', () => ({
	fetchCloudExportByPin: (...args: unknown[]) => mockFetchCloudExport(...args),
	consumeCloudExportDownload: (...args: unknown[]) => mockConsumeDownload(...args),
}));

vi.mock('$lib/server/services/data-service', () => ({
	clearAllFamilyData: vi.fn(),
}));

vi.mock('$lib/server/services/import-service', () => ({
	importFamilyData: vi.fn(),
	previewImport: vi.fn(),
	validateExportData: vi.fn(() => ({ valid: false, error: 'unused' })),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		child: { findAllChildren: mockFindAllChildren },
		childActivity: {
			findActivitiesByChild: mockFindActivitiesByChild,
			insertActivitiesBulk: mockInsertActivitiesBulk,
		},
	}),
}));

const { POST } = await import('../../../src/routes/api/v1/import/cloud/+server');

function makeRequest(body: object, mode: 'preview' | 'execute' | 'replace' = 'execute') {
	const request = new Request(`http://localhost/api/v1/import/cloud?mode=${mode}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	return {
		request,
		url: new URL(`http://localhost/api/v1/import/cloud?mode=${mode}`),
		locals: {
			context: {
				tenantId: 'tenant-test',
				role: 'owner' as const,
				licenseStatus: 'active',
			},
			identity: { type: 'cognito' as const, userId: 'u-1', email: 'a@b' },
		},
	} as unknown as Parameters<typeof POST>[0];
}

function templateV2Payload(
	buckets: Array<{ childId: number; nickname?: string; names: string[] }>,
) {
	return {
		format: 'ganbari-quest-template',
		version: '2.0.0',
		exportedAt: '2026-05-24T00:00:00.000Z',
		activitiesByChild: buckets.map((b) => ({
			childId: b.childId,
			childNickname: b.nickname ?? `child-${b.childId}`,
			activities: b.names.map((name) => ({
				name,
				categoryId: 1,
				icon: '🏃',
				basePoints: 5,
				triggerHint: null,
				isMainQuest: 0,
				priority: 'optional' as const,
			})),
		})),
		checklistTemplates: [],
	};
}

describe('POST /api/v1/import/cloud — テンプレート per-child instance (#2362 PR-3 / ADR-0055)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFindAllChildren.mockResolvedValue([
			{ id: 10, nickname: 'たろう' },
			{ id: 20, nickname: 'はなこ' },
		]);
		mockFindActivitiesByChild.mockResolvedValue([]);
		mockInsertActivitiesBulk.mockImplementation(async (inputs: Array<{ name: string }>) =>
			inputs.map((i, idx) => ({ id: 1000 + idx, name: i.name })),
		);
	});

	describe('preview mode', () => {
		it('preview は targetChildIds 不要、activitiesByChild 集計を返す', async () => {
			const payload = templateV2Payload([
				{ childId: 99, nickname: 'export-source-A', names: ['はしる', 'よむ'] },
				{ childId: 88, nickname: 'export-source-B', names: ['はみがき'] },
			]);
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(payload)),
			});

			const res = await POST(makeRequest({ pinCode: 'ABC123' }, 'preview'));
			const json = (await res.json()) as {
				ok: boolean;
				preview: {
					activities: number;
					activitiesByChild: Array<{ childId: number; activityCount: number }>;
				};
			};

			expect(res.status).toBe(200);
			expect(json.ok).toBe(true);
			expect(json.preview.activities).toBe(3);
			expect(json.preview.activitiesByChild).toHaveLength(2);
			expect(json.preview.activitiesByChild[0]).toMatchObject({ childId: 99, activityCount: 2 });
			expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
			// #3376 adversarial: preview は DL を消費しない
			expect(mockConsumeDownload).not.toHaveBeenCalled();
		});
	});

	describe('execute mode', () => {
		it('execute は targetChildIds 必須 (未指定で VALIDATION_ERROR)', async () => {
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(templateV2Payload([{ childId: 99, names: ['a'] }]))),
			});

			const res = await POST(makeRequest({ pinCode: 'ABC123' }, 'execute'));
			expect(res.status).toBe(400);
			const json = (await res.json()) as { error?: { message?: string } };
			expect(json.error?.message).toContain('お子さま');
			expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
		});

		it('execute は cross-tenant child id を拒否する (CWE-639)', async () => {
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(templateV2Payload([{ childId: 99, names: ['a'] }]))),
			});

			const res = await POST(
				makeRequest({ pinCode: 'ABC123', targetChildIds: [10, 999] }, 'execute'),
			);
			expect(res.status).toBe(400);
			const json = (await res.json()) as { error?: { message?: string } };
			expect(json.error?.message).toContain('999');
			expect(mockInsertActivitiesBulk).not.toHaveBeenCalled();
			// #3376 adversarial: validation 失敗 (cross-tenant 拒否) では DL を消費しない
			expect(mockConsumeDownload).not.toHaveBeenCalled();
		});

		it('execute は ChildSelectionDialog で選ばれた child 全員に bulk insert する', async () => {
			const payload = templateV2Payload([
				{ childId: 99, names: ['はしる', 'よむ'] },
				{ childId: 88, names: ['はみがき'] },
			]);
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(payload)),
			});

			const res = await POST(
				makeRequest({ pinCode: 'ABC123', targetChildIds: [10, 20] }, 'execute'),
			);

			expect(res.status).toBe(200);
			const json = (await res.json()) as {
				ok: boolean;
				result: { activitiesCreated: number; targetChildIds: number[] };
			};
			expect(json.ok).toBe(true);
			expect(json.result.targetChildIds).toEqual([10, 20]);
			// 各 child に 3 件 (dedup 後) ずつ → 計 6 件
			expect(json.result.activitiesCreated).toBe(6);
			expect(mockInsertActivitiesBulk).toHaveBeenCalledTimes(2);
			// #3376 adversarial: validate 成功後の execute でちょうど 1 回だけ DL を消費
			expect(mockConsumeDownload).toHaveBeenCalledTimes(1);
		});

		it('execute は per-child 既存名と衝突する activity をスキップする', async () => {
			const payload = templateV2Payload([{ childId: 99, names: ['はしる', 'よむ', 'はみがき'] }]);
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(payload)),
			});
			// child=10 には既に「はしる」がある
			mockFindActivitiesByChild.mockImplementation(async (childId: number) =>
				childId === 10 ? [{ name: 'はしる' }] : [],
			);

			const res = await POST(
				makeRequest({ pinCode: 'ABC123', targetChildIds: [10, 20] }, 'execute'),
			);

			expect(res.status).toBe(200);
			const json = (await res.json()) as { result: { activitiesCreated: number } };
			// child=10 に 2 件 (はしる スキップ) + child=20 に 3 件 = 5 件
			expect(json.result.activitiesCreated).toBe(5);
		});

		it('execute は複数 child bucket を同名 dedup してから配信する', async () => {
			// 「はしる」が 2 bucket 両方に出現 → dedup 後 1 件として扱う
			const payload = templateV2Payload([
				{ childId: 99, names: ['はしる', 'よむ'] },
				{ childId: 88, names: ['はしる', 'はみがき'] },
			]);
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(JSON.stringify(payload)),
			});

			const res = await POST(makeRequest({ pinCode: 'ABC123', targetChildIds: [10] }, 'execute'));

			const json = (await res.json()) as { result: { activitiesCreated: number } };
			// dedup 後 3 種類 → child 1 人分なので 3 件
			expect(json.result.activitiesCreated).toBe(3);
			const insertCall = mockInsertActivitiesBulk.mock.calls[0]?.[0] as Array<{ name: string }>;
			const names = insertCall.map((i) => i.name).sort();
			expect(names).toEqual(['はしる', 'はみがき', 'よむ']);
		});
	});

	describe('version compatibility', () => {
		it('旧 version 1.0.0 (family-wide shape) は拒否される', async () => {
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(
					JSON.stringify({
						format: 'ganbari-quest-template',
						version: '1.0.0',
						activities: [{ name: 'old' }],
						checklistTemplates: [],
					}),
				),
			});

			const res = await POST(makeRequest({ pinCode: 'ABC123' }, 'preview'));
			expect(res.status).toBe(400);
			const json = (await res.json()) as { error?: { message?: string } };
			expect(json.error?.message).toContain('バージョン');
		});

		it('format 不正は拒否される', async () => {
			mockFetchCloudExport.mockResolvedValue({
				record: { exportType: 'template', description: 'テスト' },
				bytes: enc(
					JSON.stringify({
						format: 'unknown',
						version: '2.0.0',
						activitiesByChild: [],
						checklistTemplates: [],
					}),
				),
			});

			const res = await POST(makeRequest({ pinCode: 'ABC123' }, 'preview'));
			expect(res.status).toBe(400);
			const json = (await res.json()) as { error?: { message?: string } };
			expect(json.error?.message).toContain('形式');
		});
	});
});
