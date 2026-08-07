import type { ChildId } from '$lib/domain/ids';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export interface IImageRepo {
	findCachedImage(
		childId: ChildId,
		type: string,
		promptHash: string,
		tenantId: string,
	): Promise<CharacterImage | undefined>;
	insertCharacterImage(input: InsertCharacterImageInput, tenantId: string): Promise<void>;
	updateChildAvatarUrl(childId: ChildId, avatarUrl: string | null, tenantId: string): Promise<void>;
	/**
	 * #4466: `avatar_url` を **読んだ時点の値と一致するときだけ** 書き換える (compare-and-set)。
	 * 書けたら true、一致せず 0 行更新なら false。
	 *
	 * 仮アバターの作り直し (`child-service`) は「いま仮アバターのままか」を先に読んで判断するが、
	 * 判断から書き込みまでの間に保護者の写真アップロードが完了しうる (await が 3 つ挟まる)。
	 * 無条件 UPDATE だと**読んだ時点の古い前提で写真の URL を踏み潰す** (lost update)。
	 * 期待値を WHERE に載せることで、レースに負けた側は 0 行更新になり写真が残る。
	 *
	 * `expectedAvatarUrl` に null を渡した場合は「まだ avatar_url が無い」ことを期待する。
	 */
	updateChildAvatarUrlIfMatches(
		childId: ChildId,
		expectedAvatarUrl: string | null,
		avatarUrl: string | null,
		tenantId: string,
	): Promise<boolean>;
	findChildForImage(childId: ChildId, tenantId: string): Promise<Child | undefined>;
	deleteByTenantId(tenantId: string, childIds?: readonly ChildId[]): Promise<void>;
}
