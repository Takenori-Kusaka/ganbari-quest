// src/lib/server/db/dynamodb/certificate-repo.ts
// DynamoDB ICertificateRepo implementation
//
// ## 経緯 (#2262 / #2263 fallback pattern)
//
// 旧 `src/lib/server/db/certificate-repo.ts` は `db` (sqlite) を直 import しており、
// 本番 cognito Lambda (DATA_SOURCE=dynamodb) では `/tmp/ganbari-quest.db` の空テーブルを
// 参照していた (= 誰の証明書も persist されず、Lambda 再起動で消失する潜在 bug)。
//
// 本実装は #2280 (PR fix: 12 DynamoDB repo Pre-PMF fallback) と同型の fallback パターンで
// Promise.all([...]) 経路の throw → 500 を予防する:
//
// - read (`findCertificates` / `findCertificateById` / `hasCertificate`): 安全値 (空 / undefined / false) + logger.warn で可視化
// - write (`issueCertificate`): no-op + logger.warn (Pre-PMF で本番未活用、本実装は別 Issue)
//
// 本番 cognito で `/admin/certificates` / `/admin/growth-book` は現状ほぼ未使用のため
// Pre-PMF stub 容認 (ADR-0010 Bucket B)。本実装時は CHILD#<id> / CERT#<padId> パターンで設計予定:
//   - PK = CHILD#<id>, SK = CERT#<padId>
//   - tenantId は keys.ts §childKey の `T#<tenantId>#` prefix で table 分離
//   - issuedAt は ISO timestamp、`onConflictDoNothing` は SK 一致で Put cond expression
//   - 期待 Throughput: 1 子供あたり <100 件、1 テナント <500 件 (TTL なし)
//
// CI gate `scripts/check-dynamodb-stub.mjs` は GRANDFATHERED_STUBS に登録済 (#2262)。

import { logger } from '$lib/server/logger';
import type { Certificate, InsertCertificateInput } from '../types';

const SERVICE = 'certificate-repo.dynamodb';

function warnRead(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] read fallback: returning empty (Pre-PMF stub, #2262)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

function warnWrite(method: string, context: Record<string, unknown>): void {
	logger.warn(`[${SERVICE}] write fallback: no-op (Pre-PMF stub, #2262)`, {
		service: SERVICE,
		context: { method, ...context },
	});
}

export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	warnWrite('issueCertificate', {
		childId: input.childId,
		certificateType: input.certificateType,
		tenantId,
	});
	return null;
}

export async function findCertificates(childId: number, tenantId: string): Promise<Certificate[]> {
	warnRead('findCertificates', { childId, tenantId });
	const empty: Certificate[] = [];
	return empty;
}

export async function findCertificateById(
	id: number,
	tenantId: string,
): Promise<Certificate | undefined> {
	warnRead('findCertificateById', { id, tenantId });
	const result: Certificate | undefined = undefined;
	return result;
}

export async function hasCertificate(
	childId: number,
	certificateType: string,
	tenantId: string,
): Promise<boolean> {
	warnRead('hasCertificate', { childId, certificateType, tenantId });
	const result = false;
	return result;
}
