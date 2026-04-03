// src/lib/server/db/certificate-repo.ts
// 証明書リポジトリ — SQLite直接アクセス（軽量パターン）

import { and, desc, eq } from 'drizzle-orm';
import { db } from './client';
import { certificates } from './schema';
import type { Certificate, InsertCertificateInput } from './types';

/** 証明書を発行（重複時はスキップ） */
export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	try {
		return (
			db
				.insert(certificates)
				.values({
					childId: input.childId,
					tenantId,
					certificateType: input.certificateType,
					title: input.title,
					description: input.description ?? null,
					metadata: input.metadata ?? null,
				})
				.onConflictDoNothing()
				.returning()
				.get() ?? null
		);
	} catch {
		return null;
	}
}

/** 子供の全証明書を取得（新しい順） */
export async function findCertificates(childId: number, tenantId: string): Promise<Certificate[]> {
	return db
		.select()
		.from(certificates)
		.where(and(eq(certificates.childId, childId), eq(certificates.tenantId, tenantId)))
		.orderBy(desc(certificates.issuedAt))
		.all();
}

/** 証明書を1件取得 */
export async function findCertificateById(
	id: number,
	tenantId: string,
): Promise<Certificate | undefined> {
	return db
		.select()
		.from(certificates)
		.where(and(eq(certificates.id, id), eq(certificates.tenantId, tenantId)))
		.get();
}

/** 特定タイプの証明書が既に発行済みか */
export async function hasCertificate(
	childId: number,
	certificateType: string,
	tenantId: string,
): Promise<boolean> {
	const row = db
		.select({ id: certificates.id })
		.from(certificates)
		.where(
			and(
				eq(certificates.childId, childId),
				eq(certificates.tenantId, tenantId),
				eq(certificates.certificateType, certificateType),
			),
		)
		.get();
	return !!row;
}
