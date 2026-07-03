// Demo IVoiceRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { ChildCustomVoice } from '../types';

export async function findByChild(
	_childId: number,
	_scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return [];
}

export async function findById(_id: number, _tenantId: string): Promise<ChildCustomVoice | null> {
	return null;
}

export async function findActiveVoice(
	_childId: number,
	_scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice | null> {
	return null;
}

export async function insert(
	_voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>,
): Promise<{ id: number }> {
	// Stub: return dummy id
	return { id: 0 };
}

export async function findAllByChild(
	_childId: number,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return [];
}

export async function insertForRestore(
	_voice: Omit<ChildCustomVoice, 'id'>,
	_tenantId: string,
): Promise<{ id: number }> {
	// Stub: return dummy id
	return { id: 0 };
}

export async function setActive(
	_id: number,
	_childId: number,
	_scene: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteById(_id: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deleteByChild(_childId: number, _tenantId: string): Promise<void> {
	// Stub: no-op
}
