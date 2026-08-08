import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	assertTenantScopedStorageKey,
	avatarKey,
	childPrefix,
	generatedImageKey,
	publicUrlToStorageKey,
	storageKeyToPublicUrl,
	tenantPrefix,
	voiceKey,
} from '$lib/server/storage-keys';

describe('storage-keys', () => {
	const tenantId = 'tenant-abc123';
	const childId = 42;

	describe('tenantPrefix', () => {
		it('テナントルートプレフィックスを返す', () => {
			expect(tenantPrefix(tenantId)).toBe('tenants/tenant-abc123/');
		});
	});

	describe('childPrefix', () => {
		it('avatars タイプの子供プレフィックスを返す', () => {
			expect(childPrefix(tenantId, asChildId(childId), 'avatars')).toBe(
				'tenants/tenant-abc123/avatars/42/',
			);
		});

		it('generated タイプの子供プレフィックスを返す', () => {
			expect(childPrefix(tenantId, asChildId(childId), 'generated')).toBe(
				'tenants/tenant-abc123/generated/42/',
			);
		});

		it('voices タイプの子供プレフィックスを返す', () => {
			expect(childPrefix(tenantId, asChildId(childId), 'voices')).toBe(
				'tenants/tenant-abc123/voices/42/',
			);
		});
	});

	describe('avatarKey', () => {
		it('テナントプレフィックス付きのアバターキーを生成する', () => {
			const key = avatarKey(tenantId, asChildId(childId), 'png');
			expect(key).toMatch(/^tenants\/tenant-abc123\/avatars\/42\/[0-9a-f-]+\.png$/);
		});

		it('呼び出しごとに異なるキーを生成する', () => {
			const key1 = avatarKey(tenantId, asChildId(childId), 'jpg');
			const key2 = avatarKey(tenantId, asChildId(childId), 'jpg');
			expect(key1).not.toBe(key2);
		});

		it('拡張子を正しく反映する', () => {
			expect(avatarKey(tenantId, asChildId(childId), 'webp')).toContain('.webp');
		});
	});

	describe('generatedImageKey', () => {
		it('promptHash 付きの生成画像キーを返す', () => {
			const key = generatedImageKey(tenantId, asChildId(childId), 'abc123hash', 'png');
			expect(key).toBe('tenants/tenant-abc123/generated/42/abc123hash.png');
		});

		it('SVG 拡張子にも対応する', () => {
			const key = generatedImageKey(tenantId, asChildId(childId), 'hash456', 'svg');
			expect(key).toBe('tenants/tenant-abc123/generated/42/hash456.svg');
		});
	});

	describe('voiceKey', () => {
		it('テナントプレフィックス付きの音声キーを生成する', () => {
			const key = voiceKey(tenantId, asChildId(childId), 'mp3');
			expect(key).toMatch(/^tenants\/tenant-abc123\/voices\/42\/[0-9a-f-]+\.mp3$/);
		});
	});

	describe('storageKeyToPublicUrl', () => {
		it('キーの先頭にスラッシュを付与する', () => {
			expect(storageKeyToPublicUrl('tenants/t1/avatars/1/abc.png')).toBe(
				'/tenants/t1/avatars/1/abc.png',
			);
		});
	});

	describe('publicUrlToStorageKey (#4468)', () => {
		it('先頭スラッシュを落として key に戻す (storageKeyToPublicUrl の逆変換)', () => {
			const key = 'tenants/t1/avatars/1/abc.png';
			expect(publicUrlToStorageKey(storageKeyToPublicUrl(key))).toBe(key);
		});

		it('仮アバターの `?v=<版>` (#4461) を落とす — 付いたままだと削除が空振りする', () => {
			expect(publicUrlToStorageKey('/tenants/t1/avatars/1/placeholder.svg?v=163ry6f')).toBe(
				'tenants/t1/avatars/1/placeholder.svg',
			);
		});

		it('fragment も落とす', () => {
			expect(publicUrlToStorageKey('/tenants/t1/avatars/1/abc.png#frag')).toBe(
				'tenants/t1/avatars/1/abc.png',
			);
		});

		it('スラッシュ無し (既に key 形) はそのまま返す', () => {
			expect(publicUrlToStorageKey('tenants/t1/avatars/1/abc.png')).toBe(
				'tenants/t1/avatars/1/abc.png',
			);
		});
	});

	describe('assertTenantScopedStorageKey (#3566 ③ §9.4)', () => {
		it('tenant プレフィックス配下の key は通す (正規の avatar/generated/voice key)', () => {
			expect(() =>
				assertTenantScopedStorageKey(avatarKey(tenantId, asChildId(childId), 'png'), tenantId),
			).not.toThrow();
			expect(() =>
				assertTenantScopedStorageKey(voiceKey(tenantId, asChildId(childId), 'mp3'), tenantId),
			).not.toThrow();
			expect(() =>
				assertTenantScopedStorageKey(`tenants/${tenantId}/generated/x.png`, tenantId),
			).not.toThrow();
		});

		it('prefix 外 key は throw (孤児バイト = account 削除 deleteByPrefix で消えない)', () => {
			expect(() => assertTenantScopedStorageKey('images/loose.png', tenantId)).toThrow();
			expect(() => assertTenantScopedStorageKey('avatars/1/x.png', tenantId)).toThrow();
		});

		it('cross-tenant key は throw (他 family バイトの越境参照 = IDOR/LFI)', () => {
			expect(() =>
				assertTenantScopedStorageKey('tenants/other-tenant/generated/steal.png', tenantId),
			).toThrow();
			// 前方一致だけ満たす別 tenant (prefix 末尾 / が境界を守る) も拒否
			expect(() =>
				assertTenantScopedStorageKey(`tenants/${tenantId}-evil/x.png`, tenantId),
			).toThrow();
		});

		it('path traversal (..) を含む key は prefix 一致でも throw', () => {
			expect(() =>
				assertTenantScopedStorageKey(`tenants/${tenantId}/../other/x.png`, tenantId),
			).toThrow();
		});

		it('error message に key 値 (child id / path 等の機微情報) を載せない', () => {
			try {
				assertTenantScopedStorageKey('tenants/secret-child-999/x.png', tenantId);
				throw new Error('should have thrown');
			} catch (e) {
				expect((e as Error).message).not.toContain('secret-child-999');
			}
		});
	});
});
