// tests/unit/routes/avatar-upload-old-file-deletion.test.ts
// #4468: 写真アップロード時に旧アバターの実ファイルを確実に削除する
//
// 仮アバターの avatar_url には `?v=<中身の版>` が付く (#4461)。avatar_url をそのまま
// storage key 扱いすると `placeholder.svg?v=163ry6f` という存在しない key を削除しようとして
// 空振りし、`placeholder.svg` が孤児として残り続ける。
//
// 期待動作:
//   - `?v=` 付き avatar_url でも query を落とした実 key (`.../placeholder.svg`) を削除する
//   - 今まさに保存した新ファイル (uuid key) は削除しない
//   - tenant プレフィックス外を指す avatar_url では削除しない (誤削除経路の遮断)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindChildById = vi.fn();
const mockUpdateChildAvatarUrl = vi.fn();
const mockSaveFile = vi.fn();
const mockDeleteFile = vi.fn();

vi.mock('$lib/server/db/activity-repo', () => ({
	findChildById: mockFindChildById,
}));

vi.mock('$lib/server/db/image-repo', () => ({
	updateChildAvatarUrl: mockUpdateChildAvatarUrl,
}));

vi.mock('$lib/server/storage', () => ({
	saveFile: mockSaveFile,
	deleteFile: mockDeleteFile,
}));

vi.mock('$lib/server/security/file-sanitizer', () => ({
	sanitizeImage: vi.fn(async (buffer: Buffer) => ({ buffer })),
}));

vi.mock('$lib/server/security/magic-bytes', () => ({
	validateImageMagicBytes: () => ({ valid: true }),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { POST } = await import('../../../src/routes/api/v1/children/[id]/avatar/+server');

const TENANT_ID = 'tenant-abc123';
const CHILD_ID = 42;

/** PNG マジックバイト付きのダミー画像 (magic-bytes は mock 済みだが実データに近づける) */
function makePngFile(): File {
	const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
	return new File([png], 'photo.png', { type: 'image/png' });
}

async function postAvatar(avatarUrl: string | null) {
	mockFindChildById.mockResolvedValue({ id: CHILD_ID, nickname: 'たろう', avatarUrl });

	const formData = new FormData();
	formData.append('avatar', makePngFile());
	// multipart を実際にシリアライズすると File の実体クラスが undici 側に入れ替わり
	// route の `instanceof File` 判定が環境依存になるため、formData() だけを備えた stub を渡す
	const request = { formData: async () => formData } as unknown as Request;

	return (await POST({
		params: { id: String(CHILD_ID) },
		request,
		locals: { context: { tenantId: TENANT_ID } },
		// biome-ignore lint/suspicious/noExplicitAny: route handler の RequestEvent を最小限で組み立てる
	} as any)) as Response;
}

describe('POST /api/v1/children/[id]/avatar — 旧アバターファイルの削除', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('仮アバター (`?v=` 付き URL) の実ファイルを削除する', async () => {
		const res = await postAvatar(
			`/tenants/${TENANT_ID}/avatars/${CHILD_ID}/placeholder.svg?v=163ry6f`,
		);

		expect(res.status).toBe(200);
		expect(mockDeleteFile).toHaveBeenCalledWith(
			`tenants/${TENANT_ID}/avatars/${CHILD_ID}/placeholder.svg`,
		);
	});

	it('query 無しの旧アバター (写真の差し替え) も従来どおり削除する', async () => {
		const oldKey = `tenants/${TENANT_ID}/avatars/${CHILD_ID}/11111111-1111-4111-8111-111111111111.png`;
		const res = await postAvatar(`/${oldKey}`);

		expect(res.status).toBe(200);
		expect(mockDeleteFile).toHaveBeenCalledWith(oldKey);
	});

	it('今保存した新ファイルは削除しない (query を落としても自己削除に化けない)', async () => {
		const res = await postAvatar(
			`/tenants/${TENANT_ID}/avatars/${CHILD_ID}/placeholder.svg?v=163ry6f`,
		);
		const newKey = mockUpdateChildAvatarUrl.mock.calls[0][1] as string;

		expect(res.status).toBe(200);
		expect(mockSaveFile).toHaveBeenCalledWith(
			newKey.replace(/^\//, ''),
			expect.anything(),
			'image/png',
		);
		expect(mockDeleteFile).not.toHaveBeenCalledWith(newKey.replace(/^\//, ''));
	});

	it('tenant プレフィックス外を指す avatar_url では削除しない (誤削除経路の遮断)', async () => {
		const res = await postAvatar('/tenants/other-tenant/avatars/999/secret.png');

		expect(res.status).toBe(200);
		expect(mockDeleteFile).not.toHaveBeenCalled();
	});
});
