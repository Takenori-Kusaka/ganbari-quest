// src/lib/server/db/image-repo.ts
// キャラクター画像関連のリポジトリ層

import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { characterImages, children } from '../schema';

/** キャッシュされた画像を取得 */
export async function findCachedImage(
	childId: number,
	type: string,
	promptHash: string,
	_tenantId: string,
) {
	return db
		.select()
		.from(characterImages)
		.where(
			and(
				eq(characterImages.childId, childId),
				eq(characterImages.type, type),
				eq(characterImages.promptHash, promptHash),
			),
		)
		.get();
}

/** 画像レコードを挿入 */
export async function insertCharacterImage(
	input: {
		childId: number;
		type: string;
		filePath: string;
		promptHash: string;
	},
	_tenantId: string,
) {
	db.insert(characterImages).values(input).run();
}

/** 子供のアバターURLを更新 */
export async function updateChildAvatarUrl(childId: number, avatarUrl: string, _tenantId: string) {
	db.update(children)
		.set({ avatarUrl, updatedAt: new Date().toISOString() })
		.where(eq(children.id, childId))
		.run();
}

/** 子供情報を取得 */
export async function findChildForImage(childId: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, childId)).get();
}

/** テナントの全キャラクター画像レコードを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(characterImages).run();
}
