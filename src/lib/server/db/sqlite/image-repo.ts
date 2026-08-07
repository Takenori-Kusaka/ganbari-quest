// src/lib/server/db/image-repo.ts
// キャラクター画像関連のリポジトリ層

import { and, eq, isNull } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { assertTenantScopedStorageKey } from '$lib/server/storage-keys';
import { db } from '../client';
import { characterImages, children } from '../schema';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

/** キャッシュされた画像を取得 */
export async function findCachedImage(
	childId: ChildId,
	type: string,
	promptHash: string,
	_tenantId: string,
): Promise<CharacterImage | undefined> {
	const row = db
		.select()
		.from(characterImages)
		.where(
			and(
				eq(characterImages.childId, Number(childId)),
				eq(characterImages.type, type),
				eq(characterImages.promptHash, promptHash),
			),
		)
		.get();
	return row ? { ...row, id: String(row.id), childId: asChildId(row.childId) } : undefined;
}

/** 画像レコードを挿入 */
export async function insertCharacterImage(input: InsertCharacterImageInput, tenantId: string) {
	// #3566 ③ (§9.4): file_path が tenant プレフィックス配下であることを DB 書込前に強制する
	// (孤児バイト / cross-tenant 参照防止、DSQL image-repo と cross-backend 整合)。
	assertTenantScopedStorageKey(input.filePath, tenantId);
	db.insert(characterImages)
		.values({ ...input, childId: Number(input.childId) })
		.run();
}

/** 子供のアバターURLを更新 */
export async function updateChildAvatarUrl(
	childId: ChildId,
	avatarUrl: string | null,
	_tenantId: string,
) {
	db.update(children)
		.set({ avatarUrl, updatedAt: new Date().toISOString() })
		.where(eq(children.id, Number(childId)))
		.run();
}

/**
 * 子供のアバターURLを、期待した値のままのときだけ更新する (#4466)。
 *
 * 仮アバターの作り直しは「いま仮アバターのままか」を先に読んで判断するが、判断から書き込みまでの
 * 間に保護者の写真アップロードが完了しうる。無条件 UPDATE だと写真の URL を踏み潰す (lost update)
 * ため、期待値を WHERE に載せて負けた側を 0 行更新にする。DSQL 側と同契約。
 *
 * SQLite はシングルテナント前提なので tenantId は使わない (同ファイルの他メソッドと同じ)。
 */
export async function updateChildAvatarUrlIfMatches(
	childId: ChildId,
	expectedAvatarUrl: string | null,
	avatarUrl: string | null,
	_tenantId: string,
): Promise<boolean> {
	// `= NULL` は常に UNKNOWN なので、期待値が null のときは IS NULL で比べる
	// (avatar_url 未設定の子供が永久に更新できなくなるのを防ぐ)。
	const expectedMatches =
		expectedAvatarUrl === null
			? isNull(children.avatarUrl)
			: eq(children.avatarUrl, expectedAvatarUrl);
	const result = db
		.update(children)
		.set({ avatarUrl, updatedAt: new Date().toISOString() })
		.where(and(eq(children.id, Number(childId)), expectedMatches))
		.run();
	return result.changes > 0;
}

/** 子供情報を取得 */
export async function findChildForImage(
	childId: ChildId,
	_tenantId: string,
): Promise<Child | undefined> {
	const row = db
		.select()
		.from(children)
		.where(eq(children.id, Number(childId)))
		.get();
	return row ? { ...row, id: asChildId(row.id) } : undefined;
}

/** テナントの全キャラクター画像レコードを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(characterImages).run();
}
