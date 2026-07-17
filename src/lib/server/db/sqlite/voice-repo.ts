import { and, eq } from 'drizzle-orm';
import { asChildId, type ChildId } from '$lib/domain/ids';
import { assertTenantScopedStorageKey } from '$lib/server/storage-keys';
import { db } from '../client';
import { childCustomVoices } from '../schema';
import type { ChildCustomVoice } from '../types';

type VoiceRow = typeof childCustomVoices.$inferSelect;

const toVoice = (r: VoiceRow): ChildCustomVoice => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

export async function findByChild(
	childId: ChildId,
	scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return db
		.select()
		.from(childCustomVoices)
		.where(and(eq(childCustomVoices.childId, Number(childId)), eq(childCustomVoices.scene, scene)))
		.all()
		.map(toVoice);
}

export async function findById(id: string, _tenantId: string): Promise<ChildCustomVoice | null> {
	const rows = db
		.select()
		.from(childCustomVoices)
		.where(eq(childCustomVoices.id, Number(id)))
		.all()
		.map(toVoice);
	return rows[0] ?? null;
}

export async function findActiveVoice(
	childId: ChildId,
	scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice | null> {
	const rows = db
		.select()
		.from(childCustomVoices)
		.where(
			and(
				eq(childCustomVoices.childId, Number(childId)),
				eq(childCustomVoices.scene, scene),
				eq(childCustomVoices.isActive, 1),
			),
		)
		.all()
		.map(toVoice);
	return rows[0] ?? null;
}

export async function insert(
	voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>,
): Promise<{ id: string }> {
	// #3566 ③ (§9.4): file_path が tenant プレフィックス配下必須 (孤児バイト防止、DSQL と整合)。
	assertTenantScopedStorageKey(voice.filePath, voice.tenantId);
	const now = new Date().toISOString();
	const result = db
		.insert(childCustomVoices)
		.values({ ...voice, childId: Number(voice.childId), createdAt: now })
		.run();
	return { id: String(result.lastInsertRowid) };
}

/** #3329 backup: child の全カスタム音声 (scene 不問、export 用)。 */
export async function findAllByChild(
	childId: ChildId,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return db
		.select()
		.from(childCustomVoices)
		.where(eq(childCustomVoices.childId, Number(childId)))
		.orderBy(childCustomVoices.scene)
		.all()
		.map(toVoice);
}

/** #3329 backup restore 用: createdAt / filePath / publicUrl / isActive を保全して音声行を復元する。 */
export async function insertForRestore(
	voice: Omit<ChildCustomVoice, 'id'>,
	_tenantId: string,
): Promise<{ id: string }> {
	// #3566 ③ (§9.4): 復元行の file_path も tenant プレフィックス強制 (untrusted backup 由来の
	// cross-tenant LFI 防止)。呼び出し側 (import-service) は復元先 tenant へ再キー済 = voice.tenantId。
	assertTenantScopedStorageKey(voice.filePath, voice.tenantId);
	const result = db
		.insert(childCustomVoices)
		.values({ ...voice, childId: Number(voice.childId) })
		.run();
	return { id: String(result.lastInsertRowid) };
}

export async function setActive(
	id: string,
	childId: ChildId,
	scene: string,
	_tenantId: string,
): Promise<void> {
	db.transaction((tx) => {
		// まず同じ子供・シーンの全ボイスを非アクティブに
		tx.update(childCustomVoices)
			.set({ isActive: 0 })
			.where(
				and(eq(childCustomVoices.childId, Number(childId)), eq(childCustomVoices.scene, scene)),
			)
			.run();
		// 指定ボイスをアクティブに
		tx.update(childCustomVoices)
			.set({ isActive: 1 })
			.where(eq(childCustomVoices.id, Number(id)))
			.run();
	});
}

export async function deleteById(id: string, _tenantId: string): Promise<void> {
	db.delete(childCustomVoices)
		.where(eq(childCustomVoices.id, Number(id)))
		.run();
}

export async function deleteByChild(childId: ChildId, _tenantId: string): Promise<void> {
	db.delete(childCustomVoices)
		.where(eq(childCustomVoices.childId, Number(childId)))
		.run();
}
