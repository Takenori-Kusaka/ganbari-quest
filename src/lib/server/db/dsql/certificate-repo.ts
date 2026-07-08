// src/lib/server/db/dsql/certificate-repo.ts
// EPIC #3424 / PR-R10 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// ICertificateRepo の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8: module-level db/client import 禁止)。db (SqlExecutor) を
//     呼び出し側 (client factory / テスト) が渡す。全メソッドが単一文で完結するため runner 不要。
//   - **§P9 tenant 述語**: 全メソッドが family_id = tenantId を WHERE に含む。
//   - **UUID surrogate PK**: certificate_id は gen_random_uuid() 採番。id = certificate_id 文字列
//     (sqlite の autoincrement 数値 id 文字列化と同 shape 契約)。childId は uuid 文字列 (§11.1)。
//   - **重複スキップ (sqlite parity)**: sqlite backend は UNIQUE(child, tenant, type) +
//     onConflictDoNothing で「1 child+type = 1 通」を保証する。DSQL schema は当該 UNIQUE を
//     意図的に未設置 (schema.ts certificates: revoke 概念が無く「要時 droppable」に非該当) のため、
//     issueCertificate は INSERT ... SELECT ... WHERE NOT EXISTS の単一文で同等の観測契約を担保する
//     (既存 type があれば 0 行 → null)。呼び出し側 (certificate-service) も hasCertificate で
//     pre-check しており、通常経路は非並行。⚠️ UNIQUE 不在のため理論上の並行 race では二重挿入が
//     起こり得る (sqlite の UNIQUE ハード保証との差)。強い一意性が要件化したら schema に
//     active_key + UNIQUE を ALTER 追加する (§11.2「要時」)。
//   - **metadata は発行後 immutable の text** (§11.2、jsonb 化せず verbatim 保全)。
//   - entity 境界: Certificate は既存 sqlite backend と同一 shape (id/tenantId/childId は文字列)。

import { sql } from 'drizzle-orm';
import { asChildId } from '$lib/domain/ids';
import type { ICertificateRepo } from '../interfaces/certificate-repo.interface';
import type { Certificate, InsertCertificateInput } from '../types';
import type { SqlExecutor } from './sql-executor';

interface CertRow {
	certificate_id: string;
	child_id: string;
	family_id: string;
	certificate_type: string;
	title: string;
	description: string | null;
	issued_at: string;
	metadata: string | null;
}

const CERT_COLUMNS = sql.raw(
	'certificate_id, child_id, family_id, certificate_type, title, description, issued_at, metadata',
);

/** row → Certificate entity (id = certificate_id uuid 文字列)。 */
function toCertificate(row: CertRow): Certificate {
	return {
		id: row.certificate_id,
		childId: asChildId(row.child_id),
		tenantId: row.family_id,
		certificateType: row.certificate_type,
		title: row.title,
		description: row.description,
		issuedAt: row.issued_at,
		metadata: row.metadata,
	};
}

/** DSQL 用 ICertificateRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlCertificateRepo(db: SqlExecutor): ICertificateRepo {
	return {
		async issueCertificate(
			input: InsertCertificateInput,
			tenantId: string,
		): Promise<Certificate | null> {
			// 重複スキップを INSERT ... SELECT ... WHERE NOT EXISTS の単一文で担保 (sqlite の
			// UNIQUE + onConflictDoNothing 相当。DSQL schema は UNIQUE 未設置のため application guard)。
			const result = await db.execute(sql`
				INSERT INTO certificates
					(family_id, child_id, certificate_type, title, description, metadata)
				SELECT ${tenantId}, ${input.childId}, ${input.certificateType}, ${input.title},
					${input.description ?? null}, ${input.metadata ?? null}
				WHERE NOT EXISTS (
					SELECT 1 FROM certificates
					WHERE family_id = ${tenantId} AND child_id = ${input.childId}
						AND certificate_type = ${input.certificateType}
				)
				RETURNING ${CERT_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CertRow | undefined;
			return row ? toCertificate(row) : null;
		},

		async findCertificates(childId, tenantId): Promise<Certificate[]> {
			const result = await db.execute(sql`
				SELECT ${CERT_COLUMNS} FROM certificates
				WHERE family_id = ${tenantId} AND child_id = ${childId}
				ORDER BY issued_at DESC, certificate_id
			`);
			return (result.rows as unknown as CertRow[]).map(toCertificate);
		},

		async findCertificateById(id, tenantId): Promise<Certificate | undefined> {
			const result = await db.execute(sql`
				SELECT ${CERT_COLUMNS} FROM certificates
				WHERE family_id = ${tenantId} AND certificate_id = ${id}
			`);
			const row = result.rows[0] as unknown as CertRow | undefined;
			return row ? toCertificate(row) : undefined;
		},

		async hasCertificate(childId, certificateType, tenantId): Promise<boolean> {
			const result = await db.execute(sql`
				SELECT 1 FROM certificates
				WHERE family_id = ${tenantId} AND child_id = ${childId}
					AND certificate_type = ${certificateType}
				LIMIT 1
			`);
			return result.rows.length > 0;
		},

		async insertForRestore(
			input: Omit<Certificate, 'id' | 'tenantId'>,
			tenantId: string,
		): Promise<Certificate | null> {
			// #3329 backup restore: issued_at / metadata を verbatim 保全 (default now に落とさない)。
			// certificate_id は新規採番 (schema default gen_random_uuid())。restore 先 child は新規 id
			// のため重複は起こらず、plain INSERT で足りる (dedup guard 不要)。
			const result = await db.execute(sql`
				INSERT INTO certificates
					(family_id, child_id, certificate_type, title, description, issued_at, metadata)
				VALUES (${tenantId}, ${input.childId}, ${input.certificateType}, ${input.title},
					${input.description}, ${input.issuedAt}::timestamptz, ${input.metadata})
				RETURNING ${CERT_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CertRow | undefined;
			return row ? toCertificate(row) : null;
		},

		async deleteByTenantId(tenantId): Promise<void> {
			// sqlite (シングルテナント全行削除) と違い family 述語で tenant 限定 (§P9)。
			await db.execute(sql`DELETE FROM certificates WHERE family_id = ${tenantId}`);
		},
	};
}
