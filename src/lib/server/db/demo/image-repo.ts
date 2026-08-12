import type { ChildId } from '$lib/domain/ids';
// Demo IImageRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.

import { DEMO_CHILDREN } from '$lib/server/demo/demo-data';
import type { CharacterImage, Child, InsertCharacterImageInput } from '../types';

export async function findCachedImage(
	_childId: ChildId,
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
	_childId: ChildId,
	_avatarUrl: string | null,
	_tenantId: string,
): Promise<void> {
	// Stub: no-op
}

/**
 * #4466: 条件付き更新 (compare-and-set) の demo Stub。
 *
 * demo backend は書き込みを一切永続しない (`updateChildAvatarUrl` も no-op)。**永続しない以上、
 * 踏み潰される写真も存在しない**ので、ここでの条件検査は空回りになる。呼び出し元 (`child-service`)
 * が false を「レースで負けた」と解釈して毎回 warn を出すのは誤報になるため、無条件版の no-op が
 * 成功扱いなのと揃えて true を返す。**demo では TOCTOU 防御は検証できない** (実効するのは
 * sqlite / dsql=PGlite の 2 backend)。
 */
export async function updateChildAvatarUrlIfMatches(
	_childId: ChildId,
	_expectedAvatarUrl: string | null,
	_avatarUrl: string | null,
	_tenantId: string,
): Promise<boolean> {
	// Stub: no-op
	return true;
}

export async function findChildForImage(
	childId: ChildId,
	_tenantId: string,
): Promise<Child | undefined> {
	return DEMO_CHILDREN.find((c) => c.id === childId);
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}
