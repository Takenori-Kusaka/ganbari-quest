/**
 * tests/unit/scripts/migrate-dynamodb-push-subscriber-role.test.ts
 *
 * #1666 (#1593 follow-up — ADR-0023 I6)
 *
 * scripts/migrate-dynamodb-push-subscriber-role.mjs の単体テスト。
 * AWS SDK モックを使用し、Scan/UpdateItem の挙動を検証する。
 */

import { describe, expect, it, vi } from 'vitest';

// AWS SDK のモック化 — vi.hoisted で先にモック関数を確保し、ESM bare specifier を fully mock する。
const { mockSend, MockScanCommand, MockUpdateCommand, MockClient, MockDocClient } = vi.hoisted(
	() => {
		const send = vi.fn();
		class ScanCmd {
			input: unknown;
			constructor(input: unknown) {
				this.input = input;
			}
			static __type = 'Scan';
			get __type() {
				return 'Scan';
			}
		}
		class UpdateCmd {
			input: unknown;
			constructor(input: unknown) {
				this.input = input;
			}
			static __type = 'Update';
			get __type() {
				return 'Update';
			}
		}
		class Client {}
		const DocClient = {
			from: () => ({ send }),
		};
		return {
			mockSend: send,
			MockScanCommand: ScanCmd,
			MockUpdateCommand: UpdateCmd,
			MockClient: Client,
			MockDocClient: DocClient,
		};
	},
);

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: MockClient,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
	DynamoDBDocumentClient: MockDocClient,
	ScanCommand: MockScanCommand,
	UpdateCommand: MockUpdateCommand,
}));

// SUT を import — モック適用後でないと参照されてしまうので動的 import
async function loadModule() {
	return import('../../../scripts/migrate-dynamodb-push-subscriber-role.mjs');
}

describe('migrate-dynamodb-push-subscriber-role', () => {
	describe('scanPushSubscriptions', () => {
		it('subscriberRole 不在のレコードを needsBackfill に含める', async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					{
						PK: 'T#tenant-1#PUSH_SUB',
						SK: 'PUSH_SUB#abc',
						endpoint: 'https://example.com/push/abc',
						// subscriberRole: 不在
					},
				],
				LastEvaluatedKey: undefined,
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.total).toBe(1);
			expect(result.needsBackfill).toHaveLength(1);
			expect(result.needsBackfill[0]).toEqual({
				PK: 'T#tenant-1#PUSH_SUB',
				SK: 'PUSH_SUB#abc',
				currentRole: null,
			});
		});

		it("subscriberRole === 'parent' のレコードは skip する (idempotent)", async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					{
						PK: 'T#tenant-1#PUSH_SUB',
						SK: 'PUSH_SUB#xyz',
						subscriberRole: 'parent',
					},
				],
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.total).toBe(1);
			expect(result.needsBackfill).toHaveLength(0);
		});

		it("subscriberRole === 'owner' のレコードも skip する", async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					{
						PK: 'T#tenant-1#PUSH_SUB',
						SK: 'PUSH_SUB#owner1',
						subscriberRole: 'owner',
					},
				],
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.needsBackfill).toHaveLength(0);
		});

		it('不正値 (旧 child / 空文字 / null) は backfill 対象に含める', async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#a', subscriberRole: 'child' },
					{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#b', subscriberRole: '' },
					{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#c', subscriberRole: null },
				],
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.needsBackfill).toHaveLength(3);
		});

		it('LastEvaluatedKey でページングする', async () => {
			mockSend.mockReset();
			mockSend
				.mockResolvedValueOnce({
					Items: [{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#1' }],
					LastEvaluatedKey: { PK: 'cursor', SK: 'cursor' },
				})
				.mockResolvedValueOnce({
					Items: [{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#2' }],
					LastEvaluatedKey: undefined,
				});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.total).toBe(2);
			expect(mockSend).toHaveBeenCalledTimes(2);
		});

		it('SK prefix が PUSH_SUB# でない & entityType も無いレコードは無視', async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					// FilterExpression で除外されるはずだが、もし通り抜けても無視されることを確認
					{ PK: 'T#t1#OTHER', SK: 'OTHER#1' },
				],
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.total).toBe(0);
		});

		it('entityType = PUSH_SUB の属性ベース判定もサポート', async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({
				Items: [
					{
						PK: 'PUSH#xyz',
						SK: 'META',
						entityType: 'PUSH_SUB',
					},
				],
			});

			const { scanPushSubscriptions } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof scanPushSubscriptions>[0];
			const result = await scanPushSubscriptions(doc, 'test-table');
			expect(result.total).toBe(1);
			expect(result.needsBackfill).toHaveLength(1);
		});
	});

	describe('updateSubscriberRole', () => {
		it("UpdateCommand に subscriberRole = 'parent' を含める", async () => {
			mockSend.mockReset();
			mockSend.mockResolvedValueOnce({});

			const { updateSubscriberRole } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof updateSubscriberRole>[0];
			await updateSubscriberRole(
				doc,
				{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#abc' },
				'test-table',
			);
			expect(mockSend).toHaveBeenCalledTimes(1);
			const cmd = mockSend.mock.calls[0]?.[0];
			// MockUpdateCommand instance の input を取り出す
			const input = (cmd as { input: Record<string, unknown> }).input;
			expect(input.TableName).toBe('test-table');
			expect(input.Key).toEqual({ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#abc' });
			expect(input.UpdateExpression).toContain('subscriberRole');
			expect(
				(input.ExpressionAttributeValues as Record<string, unknown>)[':role'],
			).toBe('parent');
		});

		it('ConditionalCheckFailedException は swallow する (既に valid role 設定済の race condition)', async () => {
			mockSend.mockReset();
			mockSend.mockRejectedValueOnce(
				Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' }),
			);

			const { updateSubscriberRole } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof updateSubscriberRole>[0];
			await expect(
				updateSubscriberRole(doc, { PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#x' }, 'test-table'),
			).resolves.toBeUndefined();
		});

		it('Throttling エラーは exponential backoff で retry する', async () => {
			mockSend.mockReset();
			mockSend
				.mockRejectedValueOnce(
					Object.assign(new Error('throttle'), { name: 'ThrottlingException' }),
				)
				.mockResolvedValueOnce({});

			const { updateSubscriberRole } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof updateSubscriberRole>[0];
			await updateSubscriberRole(
				doc,
				{ PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#abc' },
				'test-table',
			);
			expect(mockSend).toHaveBeenCalledTimes(2);
		});

		it('それ以外のエラーは throw する (caller でハンドリング)', async () => {
			mockSend.mockReset();
			mockSend.mockRejectedValue(
				Object.assign(new Error('boom'), { name: 'ResourceNotFoundException' }),
			);

			const { updateSubscriberRole } = await loadModule();
			const doc = { send: mockSend } as unknown as Parameters<typeof updateSubscriberRole>[0];
			await expect(
				updateSubscriberRole(doc, { PK: 'T#t1#PUSH_SUB', SK: 'PUSH_SUB#x' }, 'test-table'),
			).rejects.toThrow('boom');
		});
	});
});
