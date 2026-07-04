// src/lib/server/db/sqlite/certificate-repo.ts
// SQLite ICertificateRepo implementation (本番 NUC + ローカル sqlite)
//
// 旧 src/lib/server/db/certificate-repo.ts から移管 (#2262 ADR-0048 factory 化漏れ修正)。

import { and, desc, eq } from 'drizzle-orm';
import { type ChildId, asChildId } from '$lib/domain/ids';
import { db } from '../client';
import { certificates } from '../schema';
import type { Certificate, InsertCertificateInput } from '../types';

type CertificateRow = typeof certificates.$inferSelect;

const toCertificate = (r: CertificateRow): Certificate => ({
	...r,
	id: String(r.id),
	childId: asChildId(r.childId),
});

/** 証明書を発行（重複時はスキップ） */
export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	try {
		const row = db
			.insert(certificates)
			.values({
				childId: Number(input.childId),
				tenantId,
				certificateType: input.certificateType,
				title: input.title,
				description: input.description ?? null,
				metadata: input.metadata ?? null,
			})
			.onConflictDoNothing()
			.returning()
			.get();
		return row ? toCertificate(row) : null;
	} catch {
		return null;
	}
}

/** #3329 backup restore 用: issuedAt / metadata を保全して証明書を復元する。 */
export async function insertForRestore(
	input: Omit<Certificate, 'id' | 'tenantId'>,
	tenantId: string,
): Promise<Certificate | null> {
	const row = db
		.insert(certificates)
		.values({
			childId: Number(input.childId),
			tenantId,
			certificateType: input.certificateType,
			title: input.title,
			description: input.description,
			issuedAt: input.issuedAt,
			metadata: input.metadata,
		})
		.onConflictDoNothing()
		.returning()
		.get();
	return row ? toCertificate(row) : null;
}

/** #3329: テナントの全証明書を削除（SQLite: シングルテナントのため全行削除）。 */
export async function deleteByTenantId(_tenantId: string): Promise<void> {
	db.delete(certificates).run();
}

/** 子供の全証明書を取得（新しい順） */
export async function findCertificates(childId: ChildId, tenantId: string): Promise<Certificate[]> {
	return db
		.select()
		.from(certificates)
		.where(and(eq(certificates.childId, Number(childId)), eq(certificates.tenantId, tenantId)))
		.orderBy(desc(certificates.issuedAt))
		.all()
		.map(toCertificate);
}

/** 証明書を1件取得 */
export async function findCertificateById(
	id: string,
	tenantId: string,
): Promise<Certificate | undefined> {
	const row = db
		.select()
		.from(certificates)
		.where(and(eq(certificates.id, Number(id)), eq(certificates.tenantId, tenantId)))
		.get();
	return row ? toCertificate(row) : undefined;
}

/** 特定タイプの証明書が既に発行済みか */
export async function hasCertificate(
	childId: ChildId,
	certificateType: string,
	tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: certificates.id })
		.from(certificates)
		.where(
			and(
				eq(certificates.childId, Number(childId)),
				eq(certificates.tenantId, tenantId),
				eq(certificates.certificateType, certificateType),
			),
		)
		.get();
	return !!row;
}
