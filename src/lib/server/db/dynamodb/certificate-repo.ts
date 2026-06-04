// src/lib/server/db/dynamodb/certificate-repo.ts
// がんばり証明書リポジトリ — DynamoDB 本実装 (#2824 Wave 6A / ADR-0055)
//
// ICertificateRepo を SQLite 実装 (sqlite/certificate-repo.ts、挙動 SSOT) と
// 機能等価に DynamoDB single-table で実装する。
//
// 経緯: 本 repo は #2262 / #2263 で「read=空 / write=no-op + logger.warn」化された。旧 sqlite 直
//   import で本番 cognito Lambda (DATA_SOURCE=dynamodb) では誰の証明書も persist されなかった。
//   卒業証明書は子供の達成記録の核であり、Lambda 再起動で消失するのは体験毀損。本実装で根治する。
//
// key 設計 (keys.ts §certificateKey):
//   PK = T#<tenantId>#CHILD#<childId>   (child partition、special_rewards / activity_logs と同居)
//   SK = CERT#<certificateType>         (certificateType は child 内で一意)
//   → findCertificates は単一 partition Query (begins_with(SK, 'CERT#')) で完結し追加 GSI 不要
//     (ADR-0055 §3.1)。SK に certificateType を採ることで SQLite
//     uniqueIndex(child_id, tenant_id, certificate_type) を SK 一意性で表現し、issueCertificate の
//     onConflictDoNothing を attribute_not_exists(PK) 条件付き Put で等価実装する (重複 type は skip)。
//   id だけで引く findCertificateById は低頻度のため tenant Scan + id filter で 1 件特定する
//   (message-repo.findMessageItemById と同パターン)。Scan は全ページ走査する (#2842)。
//
// 関連: ADR-0055 / docs/design/08-データベース設計書.md / sqlite/certificate-repo.ts (SSOT)

import { GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { Certificate, InsertCertificateInput } from '../types';
import { getDocClient, TABLE_NAME } from './client';
import { nextId } from './counter';
import { certificateKey, certificatePrefix, childPK, ENTITY_NAMES, tenantPK } from './keys';
import { stripKeys } from './repo-helpers';

const PREFIX = certificatePrefix();

/** DynamoDB item を Certificate に正規化する (PK/SK 除去 + null 既定の補完)。 */
function toCertificate(item: Record<string, unknown>): Certificate {
	const s = stripKeys(item) as Record<string, unknown>;
	return {
		id: s.id as number,
		childId: s.childId as number,
		tenantId: s.tenantId as string,
		certificateType: s.certificateType as string,
		title: s.title as string,
		// SQLite schema: description / metadata は nullable
		description: (s.description ?? null) as string | null,
		issuedAt: s.issuedAt as string,
		metadata: (s.metadata ?? null) as string | null,
	};
}

// ============================================================
// issueCertificate — 証明書を発行（重複 type 時は skip して null）
// ============================================================

export async function issueCertificate(
	input: InsertCertificateInput,
	tenantId: string,
): Promise<Certificate | null> {
	const id = await nextId(ENTITY_NAMES.certificate, tenantId);
	const certificate: Certificate = {
		id,
		childId: input.childId,
		tenantId,
		certificateType: input.certificateType,
		title: input.title,
		description: input.description ?? null,
		// SQLite schema default 'issued_at' = CURRENT_TIMESTAMP
		issuedAt: new Date().toISOString(),
		metadata: input.metadata ?? null,
	};

	try {
		await getDocClient().send(
			new PutCommand({
				TableName: TABLE_NAME,
				Item: {
					...certificateKey(input.childId, input.certificateType, tenantId),
					...certificate,
				},
				// onConflictDoNothing 等価: 同 child + certType が既存なら Put せず例外 → null。
				ConditionExpression: 'attribute_not_exists(PK)',
			}),
		);
	} catch (e) {
		// 重複 (ConditionalCheckFailedException) は SQLite onConflictDoNothing と同じく null。
		if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
			return null;
		}
		// SQLite 実装も try/catch で全例外を null 化しているため、その他の例外も null を返す。
		return null;
	}

	return certificate;
}

// ============================================================
// findCertificates — child の全証明書を取得（新しい順）
// ============================================================

export async function findCertificates(childId: number, tenantId: string): Promise<Certificate[]> {
	const items = await queryChildCertificates(childId, tenantId);
	// SQLite: ORDER BY issued_at DESC。同 issuedAt は id 降順を tiebreaker にする。
	return items.map(toCertificate).sort(compareIssuedAtDesc);
}

// ============================================================
// findCertificateById — id + tenant で 1 件取得
// ============================================================

export async function findCertificateById(
	id: number,
	tenantId: string,
): Promise<Certificate | undefined> {
	const found = await findCertificateItemById(id, tenantId);
	if (!found) return undefined;
	return toCertificate(found);
}

// ============================================================
// hasCertificate — 特定 type の証明書が発行済みか
// ============================================================

export async function hasCertificate(
	childId: number,
	certificateType: string,
	tenantId: string,
): Promise<boolean> {
	// SK = CERT#<certificateType> が一意のため GetItem 1 回で存在判定できる。
	const result = await getDocClient().send(
		new GetCommand({
			TableName: TABLE_NAME,
			Key: certificateKey(childId, certificateType, tenantId),
			ProjectionExpression: 'id',
		}),
	);
	return !!result.Item;
}

// ============================================================
// 内部ヘルパ
// ============================================================

/**
 * issuedAt 降順 + id 降順 (tiebreaker) で比較する。
 * SQLite `ORDER BY issued_at DESC` の決定的な実装等価 (同 issuedAt 時は後発 id を先頭に)。
 */
function compareIssuedAtDesc(a: Certificate, b: Certificate): number {
	if (a.issuedAt !== b.issuedAt) return a.issuedAt < b.issuedAt ? 1 : -1;
	return b.id - a.id;
}

/** 指定 child partition の CERT# item を全件 Query する (ページング対応)。 */
async function queryChildCertificates(
	childId: number,
	tenantId: string,
): Promise<Record<string, unknown>[]> {
	const doc = getDocClient();
	const items: Record<string, unknown>[] = [];
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new QueryCommand({
				TableName: TABLE_NAME,
				KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
				ExpressionAttributeValues: {
					':pk': childPK(childId, tenantId),
					':prefix': PREFIX,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		for (const item of result.Items ?? []) items.push(item);
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return items;
}

/**
 * id だけ受け取る findCertificateById 用に、tenant 配下を Scan して item を解決する。
 * SK は CERT#<type> で id を含まないため、tenant Scan + id 属性 filter で 1 件特定する。
 * Scan は全ページ走査し一致 item で早期 return する (#2842 paging 正パターン)。
 */
async function findCertificateItemById(
	id: number,
	tenantId: string,
): Promise<Record<string, unknown> | undefined> {
	const doc = getDocClient();
	let lastKey: Record<string, unknown> | undefined;
	do {
		const result = await doc.send(
			new ScanCommand({
				TableName: TABLE_NAME,
				FilterExpression:
					'begins_with(PK, :tenantPrefix) AND begins_with(SK, :skPrefix) AND id = :id',
				ExpressionAttributeValues: {
					':tenantPrefix': tenantPK('CHILD#', tenantId),
					':skPrefix': PREFIX,
					':id': id,
				},
				ExclusiveStartKey: lastKey,
			}),
		);
		const item = (result.Items ?? [])[0];
		if (item) return item;
		lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
	} while (lastKey);
	return undefined;
}
