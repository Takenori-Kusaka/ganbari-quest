/**
 * tests/unit/db/s3-storage-repo.test.ts (#3438 Phase 1 で dynamodb-storage-repo.test.ts から改称)
 *
 * #3504 (async-backup-export.md §3.4): S3 storage の getDownloadUrl が presigned GET URL を
 * 発行し `{ kind: 'redirect', url }` を返すことを検証する。@aws-sdk/s3-request-presigner を
 * hoisted mock で置き換え、対象 key 限定 + TTL 伝播を assert する。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockGetSignedUrl, mockSend } = vi.hoisted(() => ({
	mockGetSignedUrl: vi.fn(),
	mockSend: vi.fn(),
}));

class FakeCommand {
	input: unknown;
	constructor(input: unknown) {
		this.input = input;
	}
}

vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: class {
		send = mockSend;
	},
	GetObjectCommand: FakeCommand,
	ListObjectsV2Command: class extends FakeCommand {},
	ListObjectVersionsCommand: class extends FakeCommand {},
	DeleteObjectsCommand: class extends FakeCommand {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: mockGetSignedUrl,
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('s3 storage-repo getDownloadUrl (#3504)', () => {
	it('presigned GET URL を対象 key 限定・指定 TTL で発行し redirect を返す', async () => {
		mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/presigned?sig=abc');
		const { getDownloadUrl } = await import('../../../src/lib/server/db/s3/storage-repo');

		const result = await getDownloadUrl('exports/t1/ABC234/backup.zip', { expiresIn: 300 });

		expect(result).toEqual({ kind: 'redirect', url: 'https://s3.example.com/presigned?sig=abc' });
		// getSignedUrl(client, GetObjectCommand, { expiresIn })
		const [, cmd, opts] = mockGetSignedUrl.mock.calls[0] as [
			unknown,
			{ input: { Key: string } },
			{ expiresIn: number },
		];
		expect(cmd.input.Key).toBe('exports/t1/ABC234/backup.zip');
		expect(opts.expiresIn).toBe(300);
	});
});

/**
 * #4724: バージョニングを有効にしたため `deleteByPrefix` は delete marker を立てるだけになった。
 * 退会 (完全削除) は法務文書が「猶予期間後に完全削除」と約束しているので、
 * **バージョンを名指しして消す経路** (`purgeByPrefix`) が要る。
 *
 * ここが `ListObjectsV2` に戻ると「消したつもりで 30 日残る」に静かに戻るため、
 * 発行するコマンドの種類ごと固定する。
 */
describe('s3 storage-repo purgeByPrefix (#4724)', () => {
	it('全バージョンと delete marker を VersionId 指定で削除する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Versions: [
					{ Key: 'tenants/t1/avatars/c1/a.webp', VersionId: 'v1' },
					{ Key: 'tenants/t1/avatars/c1/a.webp', VersionId: 'v2' },
				],
				DeleteMarkers: [{ Key: 'tenants/t1/voices/c1/b.webm', VersionId: 'dm1' }],
				IsTruncated: false,
			})
			.mockResolvedValueOnce({});

		const { purgeByPrefix } = await import('../../../src/lib/server/db/s3/storage-repo');
		const deleted = await purgeByPrefix('tenants/t1/');

		expect(deleted).toBe(3);

		const [listCmd] = mockSend.mock.calls[0] as [{ input: { Prefix: string } }];
		expect(listCmd.constructor.name).toBe('ListObjectVersionsCommand');
		expect(listCmd.input.Prefix).toBe('tenants/t1/');

		const [deleteCmd] = mockSend.mock.calls[1] as [
			{ input: { Delete: { Objects: Array<{ Key: string; VersionId: string }> } } },
		];
		expect(deleteCmd.constructor.name).toBe('DeleteObjectsCommand');
		// **VersionId が付いていること**が要点。付いていないと delete marker を立てるだけになる
		expect(deleteCmd.input.Delete.Objects).toEqual([
			{ Key: 'tenants/t1/avatars/c1/a.webp', VersionId: 'v1' },
			{ Key: 'tenants/t1/avatars/c1/a.webp', VersionId: 'v2' },
			{ Key: 'tenants/t1/voices/c1/b.webm', VersionId: 'dm1' },
		]);
	});

	it('ページングを最後まで辿る (1000 件で打ち切らない)', async () => {
		mockSend
			.mockResolvedValueOnce({
				Versions: [{ Key: 'tenants/t1/a', VersionId: 'v1' }],
				IsTruncated: true,
				NextKeyMarker: 'tenants/t1/a',
				NextVersionIdMarker: 'v1',
			})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({
				Versions: [{ Key: 'tenants/t1/b', VersionId: 'v2' }],
				IsTruncated: false,
			})
			.mockResolvedValueOnce({});

		const { purgeByPrefix } = await import('../../../src/lib/server/db/s3/storage-repo');
		expect(await purgeByPrefix('tenants/t1/')).toBe(2);

		const [secondList] = mockSend.mock.calls[2] as [
			{ input: { KeyMarker?: string; VersionIdMarker?: string } },
		];
		expect(secondList.input.KeyMarker).toBe('tenants/t1/a');
		expect(secondList.input.VersionIdMarker).toBe('v1');
	});

	// 通常削除は「戻せる削除」のまま。ここが purge に変わると子供の削除が復元不能になる。
	it('deleteByPrefix は VersionId を指定しない (戻せる削除のまま)', async () => {
		mockSend
			.mockResolvedValueOnce({ Contents: [{ Key: 'tenants/t1/avatars/c1/a.webp' }] })
			.mockResolvedValueOnce({});

		const { deleteByPrefix } = await import('../../../src/lib/server/db/s3/storage-repo');
		await deleteByPrefix('tenants/t1/avatars/c1/');

		const [deleteCmd] = mockSend.mock.calls[1] as [
			{ input: { Delete: { Objects: Array<Record<string, unknown>> } } },
		];
		expect(deleteCmd.input.Delete.Objects).toEqual([{ Key: 'tenants/t1/avatars/c1/a.webp' }]);
	});
});
