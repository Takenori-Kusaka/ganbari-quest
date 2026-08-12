import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { todayDateJST } from '$lib/domain/date-utils';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { db } from '../client';
import { children, siblingCheers } from '../schema';
import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

type CheerRow = typeof siblingCheers.$inferSelect;

const toCheer = (r: CheerRow): SiblingCheer => ({
	...r,
	id: String(r.id),
	fromChildId: asChildId(r.fromChildId),
	toChildId: asChildId(r.toChildId),
});

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	const now = new Date().toISOString();
	const result = db
		.insert(siblingCheers)
		.values({
			fromChildId: Number(input.fromChildId),
			toChildId: Number(input.toChildId),
			stampCode: input.stampCode,
			tenantId,
			sentAt: now,
		})
		.returning()
		.get();
	return toCheer(result);
}

/** #3329 backup: テナントの全おうえんスタンプ (from/to/sentAt/shownAt)。 */
export async function findAllByTenant(_tenantId: string): Promise<SiblingCheer[]> {
	return db.select().from(siblingCheers).orderBy(siblingCheers.sentAt).all().map(toCheer);
}

/** #3329 backup restore 用: sentAt / shownAt を保全して復元する。 */
export async function insertForRestore(
	input: Omit<SiblingCheer, 'id' | 'tenantId'>,
	tenantId: string,
): Promise<SiblingCheer> {
	// #3566 ②: restore 入力は untrusted backup 由来のため、from/to child が実在する
	// (= 同 family に属する) ことを書込前に強制する。DSQL insertForRestore の
	// INSERT ... SELECT JOIN children guard と同型の defense-in-depth (dangling 拒否)。
	// sqlite はシングルテナントのため family 帰属 = children テーブル実在で判定する
	// (FK pragma に依存せず repo 層で fail-loud 拒否)。どちらか不在なら 0 行挿入で throw。
	const fromExists = db
		.select({ id: children.id })
		.from(children)
		.where(eq(children.id, Number(input.fromChildId)))
		.get();
	const toExists = db
		.select({ id: children.id })
		.from(children)
		.where(eq(children.id, Number(input.toChildId)))
		.get();
	if (!fromExists || !toExists) {
		throw new Error('sibling cheer restore rejected: from/to child not in family');
	}
	return toCheer(
		db
			.insert(siblingCheers)
			.values({
				fromChildId: Number(input.fromChildId),
				toChildId: Number(input.toChildId),
				stampCode: input.stampCode,
				tenantId,
				sentAt: input.sentAt,
				shownAt: input.shownAt,
			})
			.returning()
			.get(),
	);
}

export async function findUnshownCheers(
	toChildId: ChildId,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	return db
		.select()
		.from(siblingCheers)
		.where(and(eq(siblingCheers.toChildId, Number(toChildId)), isNull(siblingCheers.shownAt)))
		.all()
		.map(toCheer);
}

/**
 * おうえんを既読にする。
 *
 * #4435 (逸脱 1 / 2、条件 SSOT: parallel-implementations.md §13):
 *   - **所有権**: `to_child_id` を WHERE に含める。family_id (SQLite は単一テナント DB) だけでは
 *     同一家族のきょうだいが「別の子宛のおうえん」を既読にでき、受け取る側が一度も見られない。
 *     他 3 例 (`special_rewards` / `parent_messages` / `reward_redemption_requests`) と同じ
 *     複合キー方式に揃える (#2845 課題① で sibling_cheers だけ漏れていた)。
 *   - **冪等**: `shown_at IS NULL` を WHERE に含め、再送で「最初に見せた時刻」を上書きしない
 *     (`postShown` / form 再送で 2 回叩かれうる)。
 */
export async function markShown(
	toChildId: ChildId,
	cheerIds: string[],
	_tenantId: string,
): Promise<void> {
	if (cheerIds.length === 0) return;
	const now = new Date().toISOString();
	for (const id of cheerIds) {
		db.update(siblingCheers)
			.set({ shownAt: now })
			.where(
				and(
					eq(siblingCheers.id, Number(id)),
					eq(siblingCheers.toChildId, Number(toChildId)),
					isNull(siblingCheers.shownAt),
				),
			)
			.run();
	}
}

export async function countTodayCheersFrom(
	fromChildId: ChildId,
	_tenantId: string,
): Promise<number> {
	const today = todayDateJST();
	const result = db
		.select({ value: count() })
		.from(siblingCheers)
		.where(
			and(
				eq(siblingCheers.fromChildId, Number(fromChildId)),
				gte(siblingCheers.sentAt, `${today}T00:00:00`),
			),
		)
		.get();
	return result?.value ?? 0;
}

/** テナントの全おうえんスタンプを削除（SQLite: シングルテナントのため全行削除） */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(siblingCheers).run();
}
