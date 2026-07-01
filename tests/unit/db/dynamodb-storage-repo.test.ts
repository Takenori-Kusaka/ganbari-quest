/**
 * tests/unit/db/dynamodb-storage-repo.test.ts
 *
 * #3504 (async-backup-export.md §3.4): S3 storage の getDownloadUrl が presigned GET URL を
 * 発行し `{ kind: 'redirect', url }` を返すことを検証する。@aws-sdk/s3-request-presigner を
 * hoisted mock で置き換え、対象 key 限定 + TTL 伝播を assert する。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockGetSignedUrl } = vi.hoisted(() => ({
	mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
	S3Client: class {},
	GetObjectCommand: class {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: mockGetSignedUrl,
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe('dynamodb storage-repo getDownloadUrl (#3504)', () => {
	it('presigned GET URL を対象 key 限定・指定 TTL で発行し redirect を返す', async () => {
		mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/presigned?sig=abc');
		const { getDownloadUrl } = await import('../../../src/lib/server/db/dynamodb/storage-repo');

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
