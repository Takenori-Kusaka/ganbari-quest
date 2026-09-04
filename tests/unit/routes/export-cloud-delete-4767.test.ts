// tests/unit/routes/export-cloud-delete-4767.test.ts (#4767)
//
// **DELETE /api/v1/export/cloud/:id は失敗の種類を型で見分ける**ことを route 応答で固定する。
//
// # なぜ必要か
//
// 旧実装は service が投げる素の `Error('エクスポートが見つかりません')` を
// `msg.includes('見つかりません')` で拾って 404 に写像していた。顧客向け文言を制御信号に使う形で、
// 文言を 1 文字直した瞬間に 404 が 500 (「システムに問題が発生しました」) に化ける
// (#4710 が plan 系で潰したのと同じ class)。
//
// あわせて、保管実体 (S3) の削除に失敗したときに **DB 行だけ消して「成功」を返さない**ことも固定する。
// 旧実装は purge 失敗を warn ログに落として行を削除しており、顧客には「削除できました」と見えるのに
// S3 には完全 PII の ZIP が孤児として残っていた (以後どの画面からも消せない)。
//
// # 何を fail させるか
//
// 見つからない削除が 404 以外になること / 実体削除に失敗したのに ok が返ること /
// 失敗時に顧客が「データが残っている」と分からない応答になること。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCloudExportRepo = {
	findById: vi.fn(),
	deleteById: vi.fn(),
};
const mockStorageRepo = {
	purgeByPrefix: vi.fn(),
};

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({ cloudExport: mockCloudExportRepo, storage: mockStorageRepo }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// build 経路 (cron) は本 test の対象外。module 読み込みだけ通す。
vi.mock('$lib/server/services/export-service', () => ({
	exportFamilyData: vi.fn(),
	exportFamilyDataForZip: vi.fn(),
}));

import { SETTINGS_LABELS } from '$lib/domain/labels';
import { DELETE } from '../../../src/routes/api/v1/export/cloud/[id]/+server';

interface ApiBody {
	ok?: boolean;
	error?: { code: string; message: string; userMessage: string; action: string };
}

async function callDelete(id = 'exp-1') {
	const res = (await DELETE({
		params: { id },
		locals: {
			context: { tenantId: 't-1', role: 'owner', licenseStatus: 'active', plan: 'standard' },
		},
	} as never)) as Response;
	return { status: res.status, body: (await res.json()) as ApiBody };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockCloudExportRepo.deleteById.mockResolvedValue(undefined);
	mockStorageRepo.purgeByPrefix.mockResolvedValue(undefined);
});

describe('#4767 DELETE /api/v1/export/cloud/:id — 失敗の種類を型で見分ける', () => {
	it('対象が無ければ 404 (文言の部分一致ではなく型で判定している)', async () => {
		mockCloudExportRepo.findById.mockResolvedValue(undefined);

		const { status, body } = await callDelete('missing');

		expect(status).toBe(404);
		expect(body.error?.code).toBe('NOT_FOUND');
		// 画面が読む message には「既に削除されている」ことが出る (labels SSOT 経由)
		expect(body.error?.message).toBe(SETTINGS_LABELS.cloudDeleteAlreadyGone);
		expect(mockCloudExportRepo.deleteById).not.toHaveBeenCalled();
	});

	it('保管実体の削除に失敗したら成功を返さず、データが残っていることを伝える', async () => {
		mockCloudExportRepo.findById.mockResolvedValue({
			id: 'exp-1',
			tenantId: 't-1',
			s3Key: 'exports/t-1/ABC234/backup.zip',
		});
		mockStorageRepo.purgeByPrefix.mockRejectedValueOnce(new Error('S3 down'));

		const { status, body } = await callDelete();

		expect(status).toBe(409);
		expect(body.ok).toBeUndefined();
		expect(body.error?.code).toBe('EXPORT_DELETE_FAILED');
		expect(body.error?.message).toBe(SETTINGS_LABELS.cloudDeleteFailed);
		// 単一チャネル: message と userMessage が食い違わない
		expect(body.error?.userMessage).toBe(body.error?.message);
		// 再試行できることを伝える (ADR-0062 の action)
		expect(body.error?.action).toBe('retry');
		// 行を消していない = 一覧・保管枠・実体が食い違わない
		expect(mockCloudExportRepo.deleteById).not.toHaveBeenCalled();
	});

	/**
	 * #4767 QM: **S3 の batch delete は個々のキーの失敗を例外にしない** (HTTP 200 + `Errors[]`)。
	 * repo 実装 (`purgeByPrefix`) がその配列を見て投げるようになったので、route まで貫通して
	 * 「行は残る / 409 が返る」ことを固定する。ここが緩むと、消えていない実体を抱えたまま
	 * 顧客に「削除できました」と表示する状態に戻る。
	 */
	it('実体削除が 200 + Errors[] (AccessDenied 等) で部分失敗しても、行を残して 409 を返す', async () => {
		mockCloudExportRepo.findById.mockResolvedValue({
			id: 'exp-1',
			tenantId: 't-1',
			s3Key: 'exports/t-1/ABC234/backup.zip',
		});
		// repo 層が Errors[] を見て投げる形 (s3-storage-repo.test.ts で実装側を固定済)
		mockStorageRepo.purgeByPrefix.mockRejectedValueOnce(
			new Error('S3 purge partially failed: 1/2 objects remain (backup.zip:AccessDenied)'),
		);

		const { status, body } = await callDelete();

		expect(status).toBe(409);
		expect(body.ok).toBeUndefined();
		expect(body.error?.code).toBe('EXPORT_DELETE_FAILED');
		expect(body.error?.message).toBe(SETTINGS_LABELS.cloudDeleteFailed);
		// 内部の失敗理由 (バケット名 / AccessDenied 等) は顧客に出さない (ADR-0062 §内部例外非露出)
		expect(body.error?.message).not.toContain('AccessDenied');
		expect(mockCloudExportRepo.deleteById).not.toHaveBeenCalled();
	});

	it('正常時は実体を全バージョン削除してから行を消す (上の 2 つが無条件拒否でないことの対照)', async () => {
		mockCloudExportRepo.findById.mockResolvedValue({
			id: 'exp-1',
			tenantId: 't-1',
			s3Key: 'exports/t-1/ABC234/backup.zip',
		});

		const { status, body } = await callDelete();

		expect(status).toBe(200);
		expect(body.ok).toBe(true);
		expect(mockStorageRepo.purgeByPrefix).toHaveBeenCalledWith('exports/t-1/ABC234/backup.zip');
		expect(mockCloudExportRepo.deleteById).toHaveBeenCalledWith('exp-1', 't-1');
	});
});
