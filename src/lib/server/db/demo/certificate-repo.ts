// Demo ICertificateRepo implementation
// ADR-0048 §決定 §2: stateless Fake (read) + Stub (write) hybrid.
//
// Issue #2262: 旧 src/lib/server/db/certificate-repo.ts が factory 経由でなく `db` 直 import で
// `no such table: certificates` を起こし demo Lambda /admin/growth-book を 500 にしていた構造的
// 欠陥への対策。本 Demo 実装で stateless fixture を返し growth-book LP 訴求 (証明書件数) も担保。

import { DEMO_CERTIFICATES } from '$lib/server/demo/demo-data';
import type { Certificate, InsertCertificateInput } from '../types';

export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	// Stub: 既に発行済みの fixture と type 重複なら null、それ以外は擬似的に発行成功を返す。
	const existing = DEMO_CERTIFICATES.find(
		(c) =>
			c.tenantId === tenantId &&
			c.childId === input.childId &&
			c.certificateType === input.certificateType,
	);
	if (existing) return null;
	return {
		id: 0,
		childId: input.childId,
		tenantId,
		certificateType: input.certificateType,
		title: input.title,
		description: input.description ?? null,
		metadata: input.metadata ?? null,
		issuedAt: new Date().toISOString(),
	};
}

export async function findCertificates(childId: number, tenantId: string): Promise<Certificate[]> {
	return DEMO_CERTIFICATES.filter((c) => c.childId === childId && c.tenantId === tenantId).slice();
}

export async function insertForRestore(
	input: Omit<Certificate, 'id' | 'tenantId'>,
	tenantId: string,
): Promise<Certificate | null> {
	// Stub: demo は書き込み no-op。引数の状態を反映した row を返す。
	return { ...input, id: 0, tenantId };
}

export async function deleteByTenantId(_tenantId: string): Promise<void> {
	// Stub: no-op
}

export async function findCertificateById(
	id: number,
	tenantId: string,
): Promise<Certificate | undefined> {
	return DEMO_CERTIFICATES.find((c) => c.id === id && c.tenantId === tenantId);
}

export async function hasCertificate(
	childId: number,
	certificateType: string,
	tenantId: string,
): Promise<boolean> {
	return DEMO_CERTIFICATES.some(
		(c) =>
			c.childId === childId && c.certificateType === certificateType && c.tenantId === tenantId,
	);
}
