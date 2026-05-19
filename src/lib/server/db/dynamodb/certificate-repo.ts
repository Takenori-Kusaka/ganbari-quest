// src/lib/server/db/dynamodb/certificate-repo.ts
// DynamoDB ICertificateRepo implementation (本番 AWS Lambda 用、cognito)
//
// ## 経緯 (#2262)
//
// 旧 `src/lib/server/db/certificate-repo.ts` は `db` (sqlite) を直 import しており、
// 本番 cognito Lambda (DATA_SOURCE=dynamodb) では `/tmp/ganbari-quest.db` の空テーブルを
// 参照していた (= 誰の証明書も persist されず、新規発行も sqlite に書かれて Lambda 再起動で消失)。
//
// 本 implementation は factory パターン (#2262) で routing が通るよう interface に合わせて
// 提供する。Pre-PMF (ADR-0010) のため初期実装は **空 fixture 同等の no-op stub**:
//
// - read (`findCertificates` / `findCertificateById` / `hasCertificate`): 常に空
// - write (`issueCertificate`): 擬似発行成功 (logger.warn で永続化失敗を可視化)
//
// 本番 cognito で `/admin/certificates` / `/admin/growth-book` が現状ほぼ未使用のため
// 暫定 stub 容認。証明書機能を本格起動する Issue で DynamoDB 永続化を本実装する想定:
//   - PK = CHILD#<id>, SK = CERT#<padId>
//   - tenantId は keys.ts §childKey の `T#<tenantId>#` prefix で table 分離
//   - issuedAt は ISO timestamp、`onConflictDoNothing` は SK 一致で Put cond expression
//   - 期待 Throughput: 1 子供あたり <100 件、1 テナント <500 件 (TTL なし)

import { logger } from '$lib/server/logger';
import type { Certificate, InsertCertificateInput } from '../types';

export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	logger.warn('[certificate-repo:dynamodb] issueCertificate stub (Pre-PMF, #2262)', {
		context: { childId: input.childId, certificateType: input.certificateType, tenantId },
	});
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

export async function findCertificates(
	_childId: number,
	_tenantId: string,
): Promise<Certificate[]> {
	// Pre-PMF stub (#2262): DynamoDB 永続化は別 Issue で本実装
	return [];
}

export async function findCertificateById(
	_id: number,
	_tenantId: string,
): Promise<Certificate | undefined> {
	return undefined;
}

export async function hasCertificate(
	_childId: number,
	_certificateType: string,
	_tenantId: string,
): Promise<boolean> {
	return false;
}
