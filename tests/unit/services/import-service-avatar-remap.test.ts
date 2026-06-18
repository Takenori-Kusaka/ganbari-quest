// tests/unit/services/import-service-avatar-remap.test.ts
// #3136: family import の remapChildAvatarUrls が、復元済ファイルが実在する場合のみ avatarUrl を
// 貼り替え、欠落時は null 化して dangling reference を作らないことを検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

// storage.fileExists / image-repo.updateChildAvatarUrl を mock（remap の分岐を制御）
vi.mock('$lib/server/storage', () => ({ fileExists: vi.fn(), saveFile: vi.fn() }));
vi.mock('$lib/server/db/image-repo', () => ({ updateChildAvatarUrl: vi.fn() }));

import { updateChildAvatarUrl } from '$lib/server/db/image-repo';
import {
	type AvatarRemapState,
	type ImportResult,
	remapChildAvatarUrls,
} from '$lib/server/services/import-service';
import { fileExists } from '$lib/server/storage';

const fileExistsMock = vi.mocked(fileExists);
const updateMock = vi.mocked(updateChildAvatarUrl);

const TENANT = 't-new';

/** exportId / avatarUrl を持つ最小 child を含む AvatarRemapState を組み立てる */
function makeState(
	avatarUrl: string | null,
	relativeKeyRemap: Map<string, string> = new Map(),
): AvatarRemapState {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: remap は data.family.children のみ参照する最小 stub
		data: { family: { children: [{ exportId: 'c1', avatarUrl }] } } as any,
		childIdMap: new Map([['c1', 100]]),
		oldChildToNew: new Map([[5, 100]]),
		relativeKeyRemap,
	};
}

function makeResult(): ImportResult {
	// biome-ignore lint/suspicious/noExplicitAny: errors 配列のみ参照する最小 stub
	return { errors: [] } as any;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('#3136 remapChildAvatarUrls — dangling avatarUrl 防止', () => {
	it('復元ファイルが実在しない（ZIP 同梱なし）場合は avatarUrl を null 化する', async () => {
		fileExistsMock.mockResolvedValue(false);
		await remapChildAvatarUrls(makeState('/tenants/t-old/avatars/5/abc.png'), TENANT, makeResult());
		expect(fileExistsMock).toHaveBeenCalledWith('tenants/t-new/avatars/100/abc.png');
		expect(updateMock).toHaveBeenCalledWith(100, null, TENANT);
	});

	it('復元ファイルが実在する場合は新 storage key の公開 URL に貼り替える', async () => {
		fileExistsMock.mockResolvedValue(true);
		await remapChildAvatarUrls(makeState('/tenants/t-old/avatars/5/abc.png'), TENANT, makeResult());
		expect(updateMock).toHaveBeenCalledWith(100, '/tenants/t-new/avatars/100/abc.png', TENANT);
	});

	it('relativeKeyRemap（ZIP 復元）にヒットしても、実ファイル欠落なら null 化する（dangling 防止）', async () => {
		fileExistsMock.mockResolvedValue(false);
		const remap = new Map([['avatars/5/abc.png', 'avatars/100/abc.png']]);
		await remapChildAvatarUrls(
			makeState('/tenants/t-old/avatars/5/abc.png', remap),
			TENANT,
			makeResult(),
		);
		expect(updateMock).toHaveBeenCalledWith(100, null, TENANT);
	});

	it('avatarUrl が無い child は更新しない', async () => {
		await remapChildAvatarUrls(makeState(null), TENANT, makeResult());
		expect(updateMock).not.toHaveBeenCalled();
		expect(fileExistsMock).not.toHaveBeenCalled();
	});
});
