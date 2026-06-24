// Demo IImageRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export async function findCachedImage(
	_childId: number,
	_type: string,
	_promptHash: string,
	_tenantId: string,
): Promise<CharacterImage | undefined> {
	return undefined;
}

export async function insertCharacterImage(
	_input: InsertCharacterImageInput,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function updateChildAvatarUrl(
	_childId: number,
	_avatarUrl: string | null,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function findChildForImage(
	childId: number,
	_tenantId: string,
): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === childId);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
