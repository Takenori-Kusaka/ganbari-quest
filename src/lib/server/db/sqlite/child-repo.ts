import { eq } from 'drizzle-orm';
import { db } from '../client';
import {
	activityLogs,
	characterImages,
	checklistLogs,
	checklistOverrides,
	childAchievements,
	children,
	evaluations,
	loginBonuses,
	pointLedger,
	specialRewards,
	statusHistory,
	statuses,
} from '../schema';

export async function findAllChildren(_tenantId: string) {
	return db.select().from(children).all();
}

export async function findChildById(id: number, _tenantId: string) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

export async function insertChild(
	input: {
		nickname: string;
		age: number;
		theme?: string;
		uiMode?: string;
		birthDate?: string;
	},
	_tenantId: string,
) {
	return db
		.insert(children)
		.values({
			nickname: input.nickname,
			age: input.age,
			theme: input.theme ?? 'pink',
			uiMode: input.uiMode ?? (input.age <= 2 ? 'baby' : 'kinder'),
			birthDate: input.birthDate ?? null,
		})
		.returning()
		.get();
}

export async function updateChild(
	id: number,
	input: {
		nickname?: string;
		age?: number;
		theme?: string;
		uiMode?: string;
		birthDate?: string | null;
		displayConfig?: string | null;
	},
	_tenantId: string,
) {
	return db
		.update(children)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(children.id, id))
		.returning()
		.get();
}

export async function deleteChild(id: number, _tenantId: string) {
	// トランザクションで関連データをすべて削除
	return db.transaction((tx) => {
		tx.delete(checklistOverrides).where(eq(checklistOverrides.childId, id)).run();
		tx.delete(checklistLogs).where(eq(checklistLogs.childId, id)).run();
		tx.delete(specialRewards).where(eq(specialRewards.childId, id)).run();
		tx.delete(childAchievements).where(eq(childAchievements.childId, id)).run();
		tx.delete(loginBonuses).where(eq(loginBonuses.childId, id)).run();
		tx.delete(characterImages).where(eq(characterImages.childId, id)).run();
		tx.delete(evaluations).where(eq(evaluations.childId, id)).run();
		tx.delete(statusHistory).where(eq(statusHistory.childId, id)).run();
		tx.delete(statuses).where(eq(statuses.childId, id)).run();
		tx.delete(pointLedger).where(eq(pointLedger.childId, id)).run();
		tx.delete(activityLogs).where(eq(activityLogs.childId, id)).run();
		tx.delete(children).where(eq(children.id, id)).run();
	});
}
