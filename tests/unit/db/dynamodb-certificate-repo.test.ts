/**
 * tests/unit/db/dynamodb-certificate-repo.test.ts
 *
 * #2824 Wave 6A / ADR-0055: DynamoDB がんばり証明書 repo 本実装の単体テスト。
 *
 * AWS SDK を vi.hoisted mock で置き換え、SQLite 実装 (sqlite/certificate-repo.ts、挙動 SSOT) と
 * 機能等価であることを method ごとに検証する:
 *   - 正しい Command + key で send する (PK=CHILD#<id> / SK=CERT#<certificateType>)
 *   - response を正しく型変換する (stripKeys / description / metadata null backfill)
 *   - SQLite 機能等価 (onConflictDoNothing → 重複 type は null / issued_at DESC 並び / id 解決)
 *
 * 背景: 本 repo は #2262 / #2263 で read=空 / write=no-op 化され、卒業証明書が本番 DynamoDB Lambda で
 *   永続しなかった (Lambda 再起動で消失)。本テストは本実装の機能等価性を回帰固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const {
	mockSend,
	MockGetCommand,
	MockPutCommand,
	MockQueryCommand,
	MockScanCommand,
	MockUpdateCommand,
} = vi.hoisted(() => {
	const send = vi.fn();
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		mockSend: send,
		MockGetCommand: class extends Cmd {},
		MockPutCommand: class extends Cmd {},
		MockQueryCommand: class extends Cmd {},
		MockScanCommand: class extends Cmd {},
		// counter.ts の nextId が ADD :val する UpdateCommand。
		MockUpdateCommand: class extends Cmd {},
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: MockGetCommand,
	PutCommand: MockPutCommand,
	QueryCommand: MockQueryCommand,
	ScanCommand: MockScanCommand,
	UpdateCommand: MockUpdateCommand,
}));

/** DynamoDB の ConditionalCheckFailedException を模した Error を返す。 */
function conditionalCheckFailed(): Error {
	const e = new Error('The conditional request failed');
	e.name = 'ConditionalCheckFailedException';
	return e;
}

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/certificate-repo');
}

const TENANT = 'tenant-1';
const CHILD_ID = 42;
const CERT_TYPE = 'elementary_graduation';

/** child partition の DynamoDB certificate item を組み立てる (PK/SK + 属性)。 */
function makeItem(over: Record<string, unknown> = {}): Record<string, unknown> {
	const certificateType = (over.certificateType as string) ?? CERT_TYPE;
	return {
		PK: `T#${TENANT}#CHILD#${CHILD_ID}`,
		SK: `CERT#${certificateType}`,
		id: (over.id as number) ?? 1,
		childId: CHILD_ID,
		tenantId: TENANT,
		certificateType,
		title: 'しょうがっこうそつぎょう',
		description: null,
		issuedAt: '2026-05-12T00:00:00.000Z',
		metadata: null,
		...over,
	};
}

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// issueCertificate
// ============================================================

describe('issueCertificate', () => {
	it('counter 採番 → 条件付き PutItem し SQLite default を埋めた row を返す (永続の核心経路)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 55 } }) // nextId
			.mockResolvedValueOnce({}); // PutCommand 成功

		const { issueCertificate } = await loadRepo();
		const result = await issueCertificate(
			{
				childId: CHILD_ID,
				certificateType: CERT_TYPE,
				title: 'そつぎょう',
				description: 'おめでとう',
			},
			TENANT,
		);

		expect(result?.id).toBe(55);
		expect(result).toMatchObject({
			childId: CHILD_ID,
			tenantId: TENANT,
			certificateType: CERT_TYPE,
			title: 'そつぎょう',
			description: 'おめでとう',
			metadata: null,
		});
		expect(typeof result?.issuedAt).toBe('string');

		const putCall = mockSend.mock.calls[1]?.[0] as {
			input: { Item?: Record<string, unknown>; ConditionExpression?: string };
		};
		expect(putCall.input.Item?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(putCall.input.Item?.SK).toBe(`CERT#${CERT_TYPE}`);
		// onConflictDoNothing 等価の条件式。
		expect(putCall.input.ConditionExpression).toBe('attribute_not_exists(PK)');
	});

	it('description / metadata 未指定時は null を埋める (SQLite nullable 等価)', async () => {
		mockSend.mockResolvedValueOnce({ Attributes: { counter: 1 } }).mockResolvedValueOnce({});
		const { issueCertificate } = await loadRepo();
		const result = await issueCertificate(
			{ childId: CHILD_ID, certificateType: CERT_TYPE, title: 'x' },
			TENANT,
		);
		expect(result?.description).toBeNull();
		expect(result?.metadata).toBeNull();
	});

	it('重複 type (ConditionalCheckFailed) は null を返す (onConflictDoNothing 等価)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 2 } }) // nextId
			.mockRejectedValueOnce(conditionalCheckFailed()); // Put 条件失敗

		const { issueCertificate } = await loadRepo();
		const result = await issueCertificate(
			{ childId: CHILD_ID, certificateType: CERT_TYPE, title: 'dup' },
			TENANT,
		);
		expect(result).toBeNull();
	});

	it('その他例外も null を返す (SQLite try/catch 全例外 null 化と等価)', async () => {
		mockSend
			.mockResolvedValueOnce({ Attributes: { counter: 3 } })
			.mockRejectedValueOnce(new Error('network error'));

		const { issueCertificate } = await loadRepo();
		const result = await issueCertificate(
			{ childId: CHILD_ID, certificateType: CERT_TYPE, title: 'err' },
			TENANT,
		);
		expect(result).toBeNull();
	});
});

// ============================================================
// findCertificates
// ============================================================

describe('findCertificates', () => {
	it('child partition Query し issued_at 降順で返す (SQLite ORDER BY issued_at DESC 等価)', async () => {
		mockSend.mockResolvedValueOnce({
			Items: [
				makeItem({ id: 1, certificateType: 'a', issuedAt: '2026-05-01T00:00:00.000Z' }),
				makeItem({ id: 2, certificateType: 'b', issuedAt: '2026-05-19T00:00:00.000Z' }),
				makeItem({ id: 3, certificateType: 'c', issuedAt: '2026-05-12T00:00:00.000Z' }),
			],
		});

		const { findCertificates } = await loadRepo();
		const result = await findCertificates(CHILD_ID, TENANT);

		expect(result.map((c) => c.id)).toEqual([2, 3, 1]);
		const call = mockSend.mock.calls[0]?.[0] as {
			input: { ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(call.input.ExpressionAttributeValues?.[':pk']).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(call.input.ExpressionAttributeValues?.[':prefix']).toBe('CERT#');
	});

	it('0 件なら空配列を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });
		const { findCertificates } = await loadRepo();
		await expect(findCertificates(CHILD_ID, TENANT)).resolves.toEqual([]);
	});

	it('Query をページング (LastEvaluatedKey が尽きるまで) する', async () => {
		mockSend
			.mockResolvedValueOnce({
				Items: [makeItem({ id: 1, certificateType: 'a' })],
				LastEvaluatedKey: { PK: 'x', SK: 'y' },
			})
			.mockResolvedValueOnce({ Items: [makeItem({ id: 2, certificateType: 'b' })] });

		const { findCertificates } = await loadRepo();
		const result = await findCertificates(CHILD_ID, TENANT);
		expect(result).toHaveLength(2);
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// findCertificateById
// ============================================================

describe('findCertificateById', () => {
	it('tenant Scan で id を解決し item を型変換する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeItem({ id: 9 })] });

		const { findCertificateById } = await loadRepo();
		const result = await findCertificateById(9, TENANT);

		expect(result?.id).toBe(9);
		expect(result?.certificateType).toBe(CERT_TYPE);
		const call = mockSend.mock.calls[0]?.[0] as {
			input: { FilterExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
		};
		expect(call.input.FilterExpression).toContain('id = :id');
		expect(call.input.ExpressionAttributeValues?.[':id']).toBe(9);
		expect(call.input.ExpressionAttributeValues?.[':skPrefix']).toBe('CERT#');
	});

	it('未存在なら undefined (全ページ走査後)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'p', SK: 's' } })
			.mockResolvedValueOnce({ Items: [] });
		const { findCertificateById } = await loadRepo();
		await expect(findCertificateById(999, TENANT)).resolves.toBeUndefined();
		expect(mockSend).toHaveBeenCalledTimes(2);
	});
});

// ============================================================
// hasCertificate
// ============================================================

describe('hasCertificate', () => {
	it('SK 一意の GetItem で存在判定し true を返す', async () => {
		mockSend.mockResolvedValueOnce({ Item: { id: 1 } });

		const { hasCertificate } = await loadRepo();
		const result = await hasCertificate(CHILD_ID, CERT_TYPE, TENANT);

		expect(result).toBe(true);
		const call = mockSend.mock.calls[0]?.[0] as { input: { Key?: Record<string, unknown> } };
		expect(call.input.Key?.PK).toBe(`T#${TENANT}#CHILD#${CHILD_ID}`);
		expect(call.input.Key?.SK).toBe(`CERT#${CERT_TYPE}`);
	});

	it('未存在なら false', async () => {
		mockSend.mockResolvedValueOnce({});
		const { hasCertificate } = await loadRepo();
		await expect(hasCertificate(CHILD_ID, CERT_TYPE, TENANT)).resolves.toBe(false);
	});
});
