import type { ChildId } from '$lib/domain/ids';
// Demo IVoiceRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import type { ChildCustomVoice } from '../types';

export async function findByChild(
	_childId: ChildId,
	_scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return [];
}

export async function findById(_id: string, _tenantId: string): Promise<ChildCustomVoice | null> {
	return null;
}

export async function findActiveVoice(
	_childId: ChildId,
	_scene: string,
	_tenantId: string,
): Promise<ChildCustomVoice | null> {
	return null;
}

export async function insert(
	_voice: Omit<ChildCustomVoice, 'id' | 'createdAt'>,
): Promise<{ id: string }> {
	// Stub: return dummy id
	return { id: '0' };
}

export async function findAllByChild(
	_childId: ChildId,
	_tenantId: string,
): Promise<ChildCustomVoice[]> {
	return [];
}

export async function insertForRestore(
	_voice: Omit<ChildCustomVoice, 'id'>,
	_tenantId: string,
): Promise<{ id: string } | null> {
	// Stub: demo は書き込み no-op。#3394: 永続化していないため null を返し
	// import カウント (childVoicesImported) を偽装しない (#2263 count 偽装 class)。
	return null;
}

export async function setActive(
	_id: string,
	_childId: ChildId,
	_scene: string,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

export async function deleteById(_id: string, _tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function deleteByChild(_childId: ChildId, _tenantId: string): Promise<void> {
	// Stub: no-op
}
