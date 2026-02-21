import { db } from '$lib/server/db';
import { children } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export function findAllChildren() {
	return db.select().from(children).all();
}

export function findChildById(id: number) {
	return db.select().from(children).where(eq(children.id, id)).get();
}
