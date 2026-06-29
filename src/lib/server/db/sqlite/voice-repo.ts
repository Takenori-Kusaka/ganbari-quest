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

/** #3329 backup: child の全カスタム音声 (scene 不問、export 用)。 */
export async function findAllByChild(
	childId: number,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return db
		.select()
		.from(childCustomVoices)
		.where(eq(childCustomVoices.childId, childId))
		.orderBy(childCustomVoices.scene)
		.all() as ChildCustomVoice[];
}

/** #3329 backup restore 用: createdAt / filePath / publicUrl / isActive を保全して音声行を復元する。 */
export async function insertForRestore(
	voice: Omit<ChildCustomVoice, 'id'>,
	_tenantId: string,
): Promise<{ id: number }> {
	const result = db.insert(childCustomVoices).values(voice).run();
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
