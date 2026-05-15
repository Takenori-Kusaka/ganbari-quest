// Demo IChildRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { getDefaultUiMode } from '$lib/domain/validation/age-tier';
import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import type { Child, InsertChildInput, UpdateChildInput } from '../types';

export async function findAllChildren(_tenantId: string): Promise<Child[]> {
	return DEMO_CHILDREN.filter((c) => c.isArchived === 0);
}

export async function findChildById(id: number, _tenantId: string): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function findChildByUserId(
	userId: string,
	_tenantId: string,
): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.userId === userId);
}

export async function insertChild(input: InsertChildInput, _tenantId: string): Promise<Child> {
	const now = new Date().toISOString();
	const uiMode = input.uiMode ?? getDefaultUiMode(input.age);
	return {
		id: 0,
		nickname: input.nickname,
		age: input.age,
		birthDate: input.birthDate ?? null,
		theme: input.theme ?? 'blue',
		uiMode,
		uiModeManuallySet: 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: 0,
		archivedReason: null,
		createdAt: now,
		updatedAt: now,
	};
}

export async function updateChild(
	id: number,
	_input: UpdateChildInput,
	_tenantId: string,
): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === id);
}

export async function deleteChild(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

// ---------- Archive / Restore ----------

export async function archiveChildren(
	_ids: number[],
	_reason: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function restoreArchivedChildren(_reason: string, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findArchivedChildren(_tenantId: string): Promise<Child[]> {
	return DEMO_CHILDREN.filter((c) => c.isArchived === 1);
}
