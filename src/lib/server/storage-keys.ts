// src/lib/server/storage-keys.ts
// テナントプレフィックス付きストレージキー生成ユーティリティ

import { randomUUID } from 'node:crypto';

/** テナントルートプレフィックス（一括削除用） */
export function tenantPrefix(tenantId: string): string {
	return `tenants/${tenantId}/`;
}

/** 子供単位のプレフィックス（子供削除時の一括削除用） */
export function childPrefix(
	tenantId: string,
	childId: number,
	type: 'avatars' | 'generated' | 'voices',
): string {
	return `tenants/${tenantId}/${type}/${childId}/`;
}

/** アバターアップロード用キー */
export function avatarKey(tenantId: string, childId: number, ext: string): string {
	return `tenants/${tenantId}/avatars/${childId}/${randomUUID()}.${ext}`;
}

/** AI生成画像用キー */
export function generatedImageKey(
	tenantId: string,
	childId: number,
	promptHash: string,
	ext: string,
): string {
	return `tenants/${tenantId}/generated/${childId}/${promptHash}.${ext}`;
}

/** 音声ファイル用キー（#0157 向け） */
export function voiceKey(tenantId: string, childId: number, ext: string): string {
	return `tenants/${tenantId}/voices/${childId}/${randomUUID()}.${ext}`;
}

/** ストレージキーから公開URL を生成（先頭にスラッシュ付与） */
export function storageKeyToPublicUrl(key: string): string {
	return `/${key}`;
}
