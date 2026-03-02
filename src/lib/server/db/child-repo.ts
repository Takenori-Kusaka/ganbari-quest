import { db } from '$lib/server/db';
import { children } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export function findAllChildren() {
	return db.select().from(children).all();
}

export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}

export function insertChild(input: {
	nickname: string;
	age: number;
	theme?: string;
	uiMode?: string;
}) {
	return db
		.insert(children)
		.values({
			nickname: input.nickname,
			age: input.age,
			theme: input.theme ?? 'pink',
			uiMode: input.uiMode ?? (input.age <= 2 ? 'baby' : 'kinder'),
		})
		.returning()
		.get();
}

export function updateChild(
	id: number,
	input: { nickname?: string; age?: number; theme?: string; uiMode?: string },
) {
	return db
		.update(children)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(eq(children.id, id))
		.returning()
		.get();
}

export function deleteChild(id: number) {
	return db.delete(children).where(eq(children.id, id)).run();
}
