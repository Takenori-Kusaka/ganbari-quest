// src/lib/server/storage-keys.ts
// テナントプレフィックス付きストレージキー生成ユーティリティ

import { randomUUID } from 'node:crypto';
import type { ChildId } from '$lib/domain/ids';

/** テナントルートプレフィックス（一括削除用） */
export function tenantPrefix(tenantId: string): string {
	return `tenants/${tenantId}/`;
}

/** 子供単位のプレフィックス（子供削除時の一括削除用） */
export function childPrefix(
	tenantId: string,
	childId: ChildId,
	type: 'avatars' | 'generated' | 'voices',
): string {
	return `tenants/${tenantId}/${type}/${childId}/`;
}

/** アバターアップロード用キー */
export function avatarKey(tenantId: string, childId: ChildId, ext: string): string {
	return `tenants/${tenantId}/avatars/${childId}/${randomUUID()}.${ext}`;
}

/**
 * 仮アバターのファイル名 (拡張子を除く)。**内容が差し替わっても URL が変わらない固定名**である
 * ことが配信側の Cache-Control 判断 (`safeCacheControl`) の入力になるため、キー生成と同じ SSOT を
 * 共有する (ここを変えれば配信側の判断も自動で追随する)。
 */
export const PLACEHOLDER_AVATAR_BASENAME = 'placeholder';

/**
 * 仮アバター用キー (#4413)。
 *
 * 登録時に自動生成する頭文字アバター。**アップロード写真と同じ `avatars/` prefix 配下**に置く:
 * - 子供削除時の `deleteByPrefix(childPrefix(tenantId, childId, 'avatars'))` が漏れなく回収する
 * - AI 生成画像 (`generated/`) ではなくローカル生成なので、意味の上でも `avatars/` が正しい
 *
 * ファイル名は childId ごとに固定 (uuid を振らない)。再生成すれば上書きされ、孤児が増えない。
 */
export function placeholderAvatarKey(tenantId: string, childId: ChildId, ext: string): string {
	return `tenants/${tenantId}/avatars/${childId}/${PLACEHOLDER_AVATAR_BASENAME}.${ext}`;
}

/** AI生成画像用キー */
export function generatedImageKey(
	tenantId: string,
	childId: ChildId,
	promptHash: string,
	ext: string,
): string {
	return `tenants/${tenantId}/generated/${childId}/${promptHash}.${ext}`;
}

/** 音声ファイル用キー（#0157 向け） */
export function voiceKey(tenantId: string, childId: ChildId, ext: string): string {
	return `tenants/${tenantId}/voices/${childId}/${randomUUID()}.${ext}`;
}

/** ストレージキーから公開URL を生成（先頭にスラッシュ付与） */
export function storageKeyToPublicUrl(key: string): string {
	return `/${key}`;
}

/**
 * 公開URL から storage key を復元（`storageKeyToPublicUrl` の逆変換）。
 *
 * 仮アバターの公開URL には中身の版を表す `?v=<版>` が付く (#4461)。query / fragment は
 * 配信経路のキャッシュ制御であって key の一部ではないので落とす。付いたまま key として扱うと
 * 実ファイルと一致せず、削除・存在判定が黙って空振りする (#4468)。
 */
export function publicUrlToStorageKey(publicUrl: string): string {
	const path = publicUrl.replace(/[?#].*$/s, '');
	return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * #3566 ③ (§9.4): DB に永続化する storage key が tenant プレフィックス配下であることを保証する。
 *
 * `character_images.file_path` / `child_custom_voices.file_path` など、要保護メディア (子供の顔写真 /
 * 録音) の storage key を DB に書く前に本 guard を通す。これにより DB key と `IStorageRepo` 実バイトの
 * 孤児整合を repo 層で構造的に担保する:
 *   - **blob あり row 無し (孤児バイト残存)**: account 削除の `deleteByPrefix('tenants/<tenantId>/')`
 *     (account-deletion-service) が「DB が参照する全バイト」を漏れなく削除できる。全ての DB key が
 *     `tenants/<tenantId>/` 配下である保証がなければ、prefix 外に置かれたバイトが account 削除後も
 *     残り COPPA 16CFR312.10 / GDPR Art.17 違反の孤児になる。
 *   - **cross-tenant 混入 (IDOR / LFI 相当)**: `tenants/<other>/...` を A の DB 行に書けば、A の
 *     配信経路が他 tenant のバイトを参照する孤児 = 越境になる (untrusted backup の細工 relPath も同型、
 *     import-service §voices restore の cross-tenant LFI 懸念)。prefix 一致で構造遮断する (ADR-0063 整合)。
 *   - **path traversal**: `..` を含む key は prefix 一致を満たしても FS 経路で越境しうるため拒否する。
 *
 * mis-scoped key は Error を throw (呼び出し側の key 生成バグ / 細工 input を fail-loud にする)。
 * 正規の呼び出し側 (`avatarKey` / `generatedImageKey` / `voiceKey` / import restore の再キー) は
 * 常に `tenants/<tenantId>/` を生成するため本 guard は defense-in-depth の backstop として作用する。
 * error message には key 値そのもの (child id / path を含みうる) を載せない (機微情報を露出しない)。
 */
export function assertTenantScopedStorageKey(key: string, tenantId: string): void {
	const prefix = tenantPrefix(tenantId);
	if (typeof key !== 'string' || !key.startsWith(prefix) || key.includes('..')) {
		throw new Error(`storage key is not tenant-scoped (expected prefix "${prefix}")`);
	}
}
