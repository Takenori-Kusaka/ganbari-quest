/**
 * tests/unit/db/dynamodb-stamp-card-masters.test.ts
 *
 * #2845 課題④: findEnabledStampMasters の isEnabled filter parity。
 *
 * SQLite 実装 (sqlite/stamp-card-repo.ts) は `WHERE is_enabled = 1` で絞るのに対し、
 * DynamoDB 実装は in-memory SSOT (getDefaultStampMasters) を全件 return しており
 * isEnabled=0 の master も返す filter parity 欠落があった。本テストは
 * stamp-master-defaults を mock して disabled master が除外されることを回帰固定する。
 */

import { describe, expect, it, vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
	class Cmd {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
		GetCommand: Cmd,
		PutCommand: Cmd,
		QueryCommand: Cmd,
		UpdateCommand: Cmd,
		ScanCommand: Cmd,
		BatchWriteCommand: Cmd,
	};
});

// stamp master SSOT を mock し、enabled / disabled 混在の master を返す
vi.mock('../../../src/lib/server/db/stamp-master-defaults', () => ({
	getDefaultStampMasters: () => [
		{
			id: 1,
			name: 'にこにこ',
			emoji: '😊',
			rarity: 'N',
			isDefault: 1,
			isEnabled: 1,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
		{
			id: 2,
			name: 'むこう (無効化済)',
			emoji: '🚫',
			rarity: 'N',
			isDefault: 1,
			isEnabled: 0,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		},
	],
}));

describe('findEnabledStampMasters (#2845 課題④: isEnabled filter parity)', () => {
	it('isEnabled=0 の master を除外する (SQLite WHERE is_enabled=1 と等価)', async () => {
		const { findEnabledStampMasters } = await import(
			'../../../src/lib/server/db/dynamodb/stamp-card-repo'
		);
		const masters = await findEnabledStampMasters('tenant-1');
		expect(masters.map((m) => m.id)).toEqual([1]);
		expect(masters.every((m) => m.isEnabled === 1)).toBe(true);
	});
});
