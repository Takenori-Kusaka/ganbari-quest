import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { childCustomVoices } from '../schema';
import type { ChildCustomVoice } from '../types';

export async function findByChild(
	childId: number,
	scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return db
		.select()
		.from(childCustomVoices)
		.where(and(eq(childCustomVoices.childId, childId), eq(childCustomVoices.scene, scene)))
		.all() as ChildCustomVoice[];
}

export async function findById(id: number, _tenantId: string): Promise<ChildCustomVoice | null> {
	const rows = db
		.select()
		.from(childCustomVoices)
		.where(eq(childCustomVoices.id, id))
		.all() as ChildCustomVoice[];
	return rows[0] ?? null;
}

export async function findActiveVoice(
	childId: number,
	scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice | null> {
	const rows = db
		.select()
		.from(childCustomVoices)
		.where(
			and(
				eq(childCustomVoices.childId, childId),
				eq(childCustomVoices.scene, scene),
				eq(childCustomVoices.isActive, 1),
			),
		)
		.all() as ChildCustomVoice[];
	return rows[0] ?? null;
}

export async function insert(
	voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>,
): Promise<{ id: number }> {
	const now = new Date().toISOString();
	const result = db
		.insert(childCustomVoices)
		.values({ ...voice, createdAt: now })
		.run();
	return { id: Number(result.lastInsertRowid) };
}

export async function setActive(
	id: number,
	childId: number,
	scene: string,
	_tenantId: string,
): Promise<void> {
	db.transaction((tx) => {
		// まず同じ子供・シーンの全ボイスを非アクティブに
		tx.update(childCustomVoices)
			.set({ isActive: 0 })
			.where(and(eq(childCustomVoices.childId, childId), eq(childCustomVoices.scene, scene)))
			.run();
		// 指定ボイスをアクティブに
		tx.update(childCustomVoices).set({ isActive: 1 }).where(eq(childCustomVoices.id, id)).run();
	});
}

export async function deleteById(id: number, _tenantId: string): Promise<void> {
	db.delete(childCustomVoices).where(eq(childCustomVoices.id, id)).run();
}

export async function deleteByChild(childId: number, _tenantId: string): Promise<void> {
	db.delete(childCustomVoices).where(eq(childCustomVoices.childId, childId)).run();
}
