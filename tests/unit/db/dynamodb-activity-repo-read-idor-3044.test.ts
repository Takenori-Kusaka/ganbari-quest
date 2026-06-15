/**
 * tests/unit/db/dynamodb-activity-repo-read-idor-3044.test.ts
 *
 * #3044 / #2845 (PR #3040 棚卸の read 残党): activity-repo の id-only read 2 箇所
 *   (`hasActivityLogs` / `findActivityLogById`) は tenant 無束縛 Scan のため、tenant 別
 *   採番 id/activityId 衝突時に別 tenant の log record/存在を返す cross-tenant read IDOR
 *   形状だった。本テストは修正後の挙動を回帰固定する:
 *     1. literal tenant prefix assert — ScanCommand FilterExpression が
 *        `begins_with(PK, :tenantPrefix)` を含み、:tenantPrefix が `T#<tenant>#CHILD#` であること
 *     2. 別 tenant no-op — server-side filter で 0 件に絞られた場合 false / undefined を返す
 *     3. paging — 1 page 目空 + LastEvaluatedKey で後続 page まで全走査する (#2842 false-negative 回帰)
 *
 * write 系 (#3040) と同様、tenant 束縛 + paging + 別 tenant no-op の 3 軸ガード。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AWS SDK Mock (vi.hoisted で先にモック関数と Command クラスを確保)
const { mockSend, MockGetCommand, MockScanCommand, MockQueryCommand, MockPutCommand } = vi.hoisted(
	() => {
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
			MockScanCommand: class extends Cmd {},
			MockQueryCommand: class extends Cmd {},
			MockPutCommand: class extends Cmd {},
		};
	},
);

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
	GetCommand: MockGetCommand,
	ScanCommand: MockScanCommand,
	QueryCommand: MockQueryCommand,
	PutCommand: MockPutCommand,
}));

async function loadRepo() {
	return import('../../../src/lib/server/db/dynamodb/activity-repo');
}

const TENANT = 'tenant-A';
const OTHER_TENANT = 'tenant-B';
const CHILD_ID = 42;
const ACTIVITY_ID = 7;
const LOG_ID = 100;

/** child partition の LOG item を組み立てる (PK/SK + 属性)。 */
function makeLogItem(
	tenantId: string,
	over: Record<string, unknown> = {},
): Record<string, unknown> {
	const id = (over.id as number) ?? LOG_ID;
	return {
		PK: `T#${tenantId}#CHILD#${CHILD_ID}`,
		SK: `LOG#2026-06-12#${String(id).padStart(8, '0')}`,
		id,
		childId: CHILD_ID,
		activityId: ACTIVITY_ID,
		activityName: 'なわとび',
		activityIcon: '🏃',
		categoryId: 1,
		points: 5,
		recordedDate: '2026-06-12',
		cancelled: 0,
		createdAt: '2026-06-12T00:00:00.000Z',
		...over,
	};
}

/** mockSend の i 番目の呼び出しに渡った ScanCommand.input を取り出す。 */
function scanInput(call: number): {
	FilterExpression?: string;
	ExpressionAttributeValues?: Record<string, unknown>;
	ExclusiveStartKey?: unknown;
} {
	const arg = mockSend.mock.calls[call]?.[0] as { input: Record<string, unknown> };
	return arg.input as ReturnType<typeof scanInput>;
}

beforeEach(() => {
	mockSend.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ============================================================
// hasActivityLogs — #3044 tenant 束縛
// ============================================================

describe('hasActivityLogs (#3044 cross-tenant read IDOR guard)', () => {
	it('FilterExpression に begins_with(PK, :tenantPrefix) を含み、自 tenant prefix で束縛する', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeLogItem(TENANT)] });

		const { hasActivityLogs } = await loadRepo();
		const result = await hasActivityLogs(ACTIVITY_ID, TENANT);

		expect(result).toBe(true);
		const input = scanInput(0);
		expect(input.FilterExpression).toContain('begins_with(PK, :tenantPrefix)');
		expect(input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(input.ExpressionAttributeValues?.[':activityId']).toBe(ACTIVITY_ID);
	});

	it('別 tenant の query では prefix が別 tenant になる (cross-tenant 越境不可)', async () => {
		mockSend.mockResolvedValueOnce({ Items: [] });

		const { hasActivityLogs } = await loadRepo();
		const result = await hasActivityLogs(ACTIVITY_ID, OTHER_TENANT);

		// server-side filter で 0 件に絞られたら false (別 tenant の log は越境 hit しない)
		expect(result).toBe(false);
		expect(scanInput(0).ExpressionAttributeValues?.[':tenantPrefix']).toBe(
			`T#${OTHER_TENANT}#CHILD#`,
		);
	});

	it('1 page 目空 + LastEvaluatedKey で後続 page まで全走査する (#2842 false-negative 回帰)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'x', SK: 'y' } })
			.mockResolvedValueOnce({ Items: [makeLogItem(TENANT)] });

		const { hasActivityLogs } = await loadRepo();
		const result = await hasActivityLogs(ACTIVITY_ID, TENANT);

		expect(result).toBe(true);
		expect(mockSend).toHaveBeenCalledTimes(2);
		// 全 page で tenant 束縛が維持される
		expect(scanInput(1).ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(scanInput(1).ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
	});
});

// ============================================================
// findActivityLogById — #3044 tenant 束縛
// ============================================================

describe('findActivityLogById (#3044 cross-tenant read IDOR guard)', () => {
	it('FilterExpression に begins_with(PK, :tenantPrefix) を含み、自 tenant の log を返す', async () => {
		mockSend.mockResolvedValueOnce({ Items: [makeLogItem(TENANT)] });

		const { findActivityLogById } = await loadRepo();
		const log = await findActivityLogById(LOG_ID, TENANT);

		expect(log?.id).toBe(LOG_ID);
		const input = scanInput(0);
		expect(input.FilterExpression).toContain('begins_with(PK, :tenantPrefix)');
		expect(input.ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
		expect(input.ExpressionAttributeValues?.[':id']).toBe(LOG_ID);
	});

	it('別 tenant に同 id の log があっても自 tenant で 0 件なら undefined (cross-tenant 越境不可)', async () => {
		// server-side filter が別 tenant の record を除外 → 0 件
		mockSend.mockResolvedValueOnce({ Items: [] });

		const { findActivityLogById } = await loadRepo();
		const log = await findActivityLogById(LOG_ID, TENANT);

		expect(log).toBeUndefined();
		expect(scanInput(0).ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
	});

	it('1 page 目空 + LastEvaluatedKey で後続 page まで全走査する (#2842 取りこぼし回帰)', async () => {
		mockSend
			.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { PK: 'x', SK: 'y' } })
			.mockResolvedValueOnce({ Items: [makeLogItem(TENANT, { id: LOG_ID })] });

		const { findActivityLogById } = await loadRepo();
		const log = await findActivityLogById(LOG_ID, TENANT);

		expect(log?.id).toBe(LOG_ID);
		expect(mockSend).toHaveBeenCalledTimes(2);
		expect(scanInput(1).ExpressionAttributeValues?.[':tenantPrefix']).toBe(`T#${TENANT}#CHILD#`);
	});
});
