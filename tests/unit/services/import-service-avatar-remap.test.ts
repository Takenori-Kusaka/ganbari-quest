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

	it('relativeKeyRemap ミス時に .. traversal を含む avatarUrl は null 化し、traversed key を fileExists で probe しない（zip-slip 防御）', async () => {
		// relativeKeyRemap は空 → fallback 分岐 (STATIC_FILE_PATH_RE 再構成) に入る。
		// rest = `5/../../../t-other/avatars/9/secret.png` で `..` を含むため isSafeRelativePath が弾く想定。
		const traversal = '/tenants/t-old/avatars/5/../../../t-other/avatars/9/secret.png';
		await remapChildAvatarUrls(makeState(traversal), TENANT, makeResult());
		// unsafe key は決して fileExists で probe されない（存在オラクル化を防ぐ）
		expect(fileExistsMock).not.toHaveBeenCalled();
		// dangling→null と同じ挙動で avatarUrl は null 化される
		expect(updateMock).toHaveBeenCalledWith(100, null, TENANT);
		// traversed/.. を含む key で更新しない（公開 URL を永続化しない）
		for (const call of updateMock.mock.calls) {
			expect(String(call[1])).not.toContain('..');
		}
	});
});

// #3230: URL エンコード traversal (`%2e%2e` / 二重エンコード / `..%2f`) がデコード差異で
// tenant 境界を迂回しないことを固定する。アプリ層 (isSafeRelativePath / remapChildAvatarUrls) は
// raw 文字列を扱い URL デコードしないため、エンコードされた traversal は literal な 1 セグメントとして
// 扱われ親ディレクトリ参照にならない。invariant: 永続化される avatarUrl / fileExists で probe する key は
// 必ず取込先 tenant prefix (`tenants/t-new/`) 内に閉じ、別 tenant に escape しない。
describe('#3230 invariant: URL エンコード traversal はデコード差異で tenant 境界を迂回しない', () => {
	const ENCODED_TRAVERSALS = [
		'/tenants/t-old/avatars/5/%2e%2e/%2e%2e/t-other/avatars/9/secret.png', // %2e%2e = encoded ..
		'/tenants/t-old/avatars/5/%252e%252e/t-other/avatars/9/secret.png', // 二重エンコード
		'/tenants/t-old/avatars/5/..%2f..%2ft-other/avatars/9/secret.png', // エンコード slash
	];

	for (const url of ENCODED_TRAVERSALS) {
		it(`encoded traversal は t-new tenant 内に閉じ別 tenant へ escape しない: ${url}`, async () => {
			fileExistsMock.mockResolvedValue(false);
			await remapChildAvatarUrls(makeState(url), TENANT, makeResult());
			// 永続化される avatarUrl は null か、取込先 tenant prefix 内のみ (別 tenant key を生成しない)
			for (const call of updateMock.mock.calls) {
				const v = call[1];
				if (v !== null) expect(String(v)).toMatch(/^\/tenants\/t-new\//);
			}
			// fileExists で probe する key も取込先 tenant prefix を逸脱しない (デコードで escape しない)
			for (const call of fileExistsMock.mock.calls) {
				expect(String(call[0])).toMatch(/^tenants\/t-new\//);
			}
		});
	}
});

// #3139: avatarUrl anchor の不変条件 — 「avatarUrl は server 生成 path 以外から設定されない」。
// #3137 の cross-tenant IDOR 根治は「child.avatarUrl は server が tenant-scoped key からのみ生成する
// (attacker 不可設定)」を anchor とする。将来 import/restore が attacker-influenced な avatarUrl を
// そのまま採用すると anchor が silently 無効化され IDOR が再発しうる (CI は green のまま)。
// 本テスト群は remapChildAvatarUrls が「外部入力由来の文字列を verbatim 永続化しない」ことを固定する。
describe('#3139 invariant: avatarUrl は外部入力から verbatim 採用されない (anchor robustness)', () => {
	it('attacker 由来の外部 URL (/tenants/ を含まない) は採用されず persist しない', async () => {
		fileExistsMock.mockResolvedValue(true);
		await remapChildAvatarUrls(
			makeState('https://evil.example/avatars/5/x.png'),
			TENANT,
			makeResult(),
		);
		// regex 非マッチ → skip。外部 URL を verbatim 永続化しない
		expect(updateMock).not.toHaveBeenCalled();
		expect(fileExistsMock).not.toHaveBeenCalled();
	});

	it('javascript: scheme 等の非 path 文字列も採用しない', async () => {
		fileExistsMock.mockResolvedValue(true);
		await remapChildAvatarUrls(makeState('javascript:alert(1)'), TENANT, makeResult());
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('外部 host を含む偽装 path でも、host は剥がされ取込先 tenant の server key にのみ再構成される', async () => {
		// `/tenants/t-evil/avatars/5/x.png` 部分が regex にマッチしても、再構成 key は取込先
		// tenant (t-new) prefix + マップ済 childId で組まれ、外部 host / 別 tenant は反映されない。
		fileExistsMock.mockResolvedValue(true);
		await remapChildAvatarUrls(
			makeState('https://evil.example/tenants/t-evil/avatars/5/x.png'),
			TENANT,
			makeResult(),
		);
		expect(updateMock).toHaveBeenCalledTimes(1);
		const persistedUrl = String(updateMock.mock.calls[0]?.[1]);
		expect(persistedUrl).toBe('/tenants/t-new/avatars/100/x.png');
		expect(persistedUrl).not.toContain('evil.example');
		expect(persistedUrl).not.toContain('t-evil');
	});

	it('別 tenant path も取込先 tenant prefix に再構成される (cross-tenant 越境しない)', async () => {
		fileExistsMock.mockResolvedValue(true);
		await remapChildAvatarUrls(makeState('/tenants/t-other/avatars/5/x.png'), TENANT, makeResult());
		const persistedUrl = String(updateMock.mock.calls[0]?.[1]);
		expect(persistedUrl).toBe('/tenants/t-new/avatars/100/x.png');
		expect(persistedUrl).not.toContain('t-other');
	});

	it('不変条件: persist される avatarUrl は null か 取込先 tenant の server prefix 配下のみ (多様な悪性入力)', async () => {
		const malicious = [
			'https://evil.example/x.png',
			'//evil.example/avatars/5/x.png',
			'/etc/passwd',
			'/tenants/t-other/avatars/5/legit.png',
			'https://evil.example/tenants/t-evil/avatars/5/x.png',
			'/tenants/t-old/avatars/5/../../../t-x/avatars/9/secret.png',
		];
		fileExistsMock.mockResolvedValue(true);
		for (const url of malicious) {
			await remapChildAvatarUrls(makeState(url), TENANT, makeResult());
		}
		// 1 件でも null/取込先 tenant prefix 以外を永続化したら invariant 違反
		for (const call of updateMock.mock.calls) {
			const persisted = call[1];
			if (persisted === null) continue;
			expect(String(persisted).startsWith(`/tenants/${TENANT}/`)).toBe(true);
		}
	});
});
