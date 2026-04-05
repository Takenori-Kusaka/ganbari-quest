import { and, count, eq, gte, isNull } from 'drizzle-orm';
import { db } from '../client';
import { siblingCheers } from '../schema';
import type { InsertSiblingCheerInput, SiblingCheer } from '../types';

export async function insertCheer(
	input: InsertSiblingCheerInput,
	tenantId: string,
): Promise<SiblingCheer> {
	const now = new Date().toISOString();
	const result = db
		.insert(siblingCheers)
		.values({
			fromChildId: input.fromChildId,
			toChildId: input.toChildId,
			stampCode: input.stampCode,
			tenantId,
			sentAt: now,
		})
		.returning()
		.get();
	return result;
}

export async function findUnshownCheers(
	toChildId: number,
	_tenantId: string,
): Promise<SiblingCheer[]> {
	return db
		.select()
		.from(siblingCheers)
		.where(and(eq(siblingCheers.toChildId, toChildId), isNull(siblingCheers.shownAt)))
		.all();
}

export async function markShown(cheerIds: number[], _tenantId: string): Promise<void> {
	if (cheerIds.length === 0) return;
	const now = new Date().toISOString();
	for (const id of cheerIds) {
		db.update(siblingCheers).set({ shownAt: now }).where(eq(siblingCheers.id, id)).run();
	}
}

export async function countTodayCheersFrom(
	fromChildId: number,
	_tenantId: string,
): Promise<number> {
	const today = new Date().toISOString().slice(0, 10);
	const result = db
		.select({ value: count() })
		.from(siblingCheers)
		.where(
			and(
				eq(siblingCheers.fromChildId, fromChildId),
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
