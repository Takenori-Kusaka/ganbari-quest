import { describe, expect, it } from 'vitest';
import { asChildId } from '$lib/domain/ids';
import {
	avatarKey,
	childPrefix,
	generatedImageKey,
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
});
