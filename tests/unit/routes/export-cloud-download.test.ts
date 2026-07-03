// tests/unit/routes/export-cloud-download.test.ts
//
// #3504 (async-backup-export.md §3.4): クラウドエクスポート一時 DL route の認可 + 配信分岐検証。
//   - 未認証 401 / child role 403 (requireRole) / 他 tenant のリソース 404 (IDOR)
//   - status!=ready で配信不可 (400) / 期限切れ (400) / DL 上限 (400)
//   - ready かつ AWS(redirect) → 302 / NUC(proxy) → 200 stream
//   - 消費: 配信成功時に incrementDownloadCount を呼ぶ

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCloudExportRepo = {
	findById: vi.fn(),
	incrementDownloadCount: vi.fn(),
};
const mockStorageRepo = {
	getDownloadUrl: vi.fn(),
	readFile: vi.fn(),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ cloudExport: mockCloudExportRepo, storage: mockStorageRepo }),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { GET } from '../../../src/routes/api/v1/export/cloud/[id]/download/+server';

function locals(role: string | null): App.Locals {
	if (role === null) return { context: undefined } as unknown as App.Locals;
	return { context: { tenantId: 't-1', role } } as unknown as App.Locals;
}

async function callGet(
	role: string | null,
	id: string,
): Promise<{ status?: number; res?: Response; thrown?: unknown }> {
	try {
		const res = (await GET({ params: { id }, locals: locals(role) } as never)) as Response;
		return { status: res?.status, res };
	} catch (e) {
		return { thrown: e, status: (e as { status?: number })?.status };
	}
}

function readyRecord(overrides: Record<string, unknown> = {}) {
	const future = new Date();
	future.setDate(future.getDate() + 3);
	return {
		id: 1,
		tenantId: 't-1',
		s3Key: 'exports/t-1/ABC234/backup.zip',
		status: 'ready',
		expiresAt: future.toISOString(),
		downloadCount: 0,
		maxDownloads: 10,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('export/cloud/[id]/download GET — 認可', () => {
	it('未認証は 401', async () => {
		const r = await callGet(null, '1');
		expect(r.status).toBe(401);
	});

	it('child role は 403 (requireRole)', async () => {
		const r = await callGet('child', '1');
		expect(r.status).toBe(403);
	});

	it('無効な id は 400', async () => {
		const r = await callGet('parent', 'abc');
		expect(r.status).toBe(400);
	});

	it('他 tenant のリソースは findById が undefined → 404 (IDOR 遮断)', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(undefined);
		const r = await callGet('parent', '999');
		expect(r.status).toBe(404);
		// findById は tenantId 束縛で呼ばれる
		expect(mockCloudExportRepo.findById).toHaveBeenCalledWith(999, 't-1');
	});
});

describe('export/cloud/[id]/download GET — 状態ガード', () => {
	it('status!=ready (building) は 400 で配信しない', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(readyRecord({ status: 'building' }));
		const r = await callGet('parent', '1');
		expect(r.status).toBe(400);
		expect(mockStorageRepo.getDownloadUrl).not.toHaveBeenCalled();
	});

	it('期限切れは 400', async () => {
		const past = new Date();
		past.setDate(past.getDate() - 1);
		mockCloudExportRepo.findById.mockResolvedValue(readyRecord({ expiresAt: past.toISOString() }));
		const r = await callGet('parent', '1');
		expect(r.status).toBe(400);
	});

	it('DL 上限到達は 400', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(
			readyRecord({ downloadCount: 10, maxDownloads: 10 }),
		);
		const r = await callGet('parent', '1');
		expect(r.status).toBe(400);
	});
});

describe('export/cloud/[id]/download GET — 配信分岐', () => {
	it('AWS(redirect): 302 で presigned URL に飛ばし DL を消費する', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(readyRecord());
		mockStorageRepo.getDownloadUrl.mockResolvedValue({
			kind: 'redirect',
			url: 'https://s3/presigned',
		});
		const r = await callGet('parent', '1');
		expect(r.status).toBe(302);
		expect(r.res?.headers.get('location')).toBe('https://s3/presigned');
		expect(mockStorageRepo.getDownloadUrl).toHaveBeenCalledWith('exports/t-1/ABC234/backup.zip', {
			expiresIn: 300,
		});
		expect(mockCloudExportRepo.incrementDownloadCount).toHaveBeenCalledWith(1, 't-1');
	});

	it('NUC(proxy): 200 で readFile を stream し attachment + DL 消費', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(readyRecord());
		mockStorageRepo.getDownloadUrl.mockResolvedValue({ kind: 'proxy' });
		mockStorageRepo.readFile.mockResolvedValue({
			data: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
			contentType: 'application/zip',
		});
		const r = await callGet('parent', '1');
		expect(r.status).toBe(200);
		expect(r.res?.headers.get('content-type')).toBe('application/zip');
		expect(r.res?.headers.get('content-disposition')).toContain('backup.zip');
		expect(mockCloudExportRepo.incrementDownloadCount).toHaveBeenCalledWith(1, 't-1');
	});

	it('proxy で実体不在 (readFile null) は 404', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(readyRecord());
		mockStorageRepo.getDownloadUrl.mockResolvedValue({ kind: 'proxy' });
		mockStorageRepo.readFile.mockResolvedValue(null);
		const r = await callGet('parent', '1');
		expect(r.status).toBe(404);
		expect(mockCloudExportRepo.incrementDownloadCount).not.toHaveBeenCalled();
	});
});
