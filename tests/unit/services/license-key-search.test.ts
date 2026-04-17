// tests/unit/services/license-key-search.test.ts
// IAuthRepo の検索メソッド (#816) のユニットテスト
// DynamoDB 実装のモック + SQLite (local) 実装のスタブの両方をテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LICENSE_KEY_STATUS } from '$lib/domain/constants/license-key-status';
import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';
import type { LicenseRecord } from '$lib/server/services/license-key-service';

// ============================================================
// Mock: SQLite local mode (no-op stubs)
// ============================================================

describe('SQLite auth-repo (local mode) — license key search (#816)', () => {
	// SQLite モジュールを直接テスト
	// vi.mock は不要: SQLite 実装は DynamoDB に依存しないスタブ

	beforeEach(() => {
		vi.resetModules();
	});

	it('listLicenseKeysByTenant は空ページを返す', async () => {
		const mod = await import('$lib/server/db/sqlite/auth-repo');
		const result = await mod.listLicenseKeysByTenant('t-123');
		expect(result).toEqual({ items: [], cursor: null });
	});

	it('listLicenseKeysByStatus は空ページを返す', async () => {
		const mod = await import('$lib/server/db/sqlite/auth-repo');
		const result = await mod.listLicenseKeysByStatus(LICENSE_KEY_STATUS.ACTIVE);
		expect(result).toEqual({ items: [], cursor: null });
	});

	it('listExpiringSoon は空配列を返す', async () => {
		const mod = await import('$lib/server/db/sqlite/auth-repo');
		const result = await mod.listExpiringSoon(30);
		expect(result).toEqual([]);
	});

	it('countLicenseKeys は 0 を返す', async () => {
		const mod = await import('$lib/server/db/sqlite/auth-repo');
		const result = await mod.countLicenseKeys();
		expect(result).toBe(0);
	});
});

// ============================================================
// Mock: DynamoDB implementation
// ============================================================

// DynamoDB SDK をモックして auth-repo の検索メソッドをテスト
const mockSend = vi.fn();

vi.mock('@aws-sdk/lib-dynamodb', () => {
	class MockQueryCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class MockScanCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class MockGetCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class MockPutCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class MockDeleteCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	class MockUpdateCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	}
	return {
		DynamoDBDocumentClient: {
			from: () => ({ send: mockSend }),
		},
		QueryCommand: MockQueryCommand,
		ScanCommand: MockScanCommand,
		GetCommand: MockGetCommand,
		PutCommand: MockPutCommand,
		DeleteCommand: MockDeleteCommand,
		UpdateCommand: MockUpdateCommand,
	};
});

vi.mock('@aws-sdk/client-dynamodb', () => ({
	DynamoDBClient: class {
		destroy() {
			/* noop */
		}
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

function makeLicenseItem(
	overrides: Partial<LicenseRecord> & { licenseKey: string },
): Record<string, unknown> {
	return {
		PK: `LICENSE#${overrides.licenseKey}`,
		SK: `LICENSE#${overrides.licenseKey}`,
		GSI2PK: `TENANT#${overrides.tenantId ?? 't-1'}`,
		GSI2SK: `LICENSE#${overrides.createdAt ?? '2026-04-01T00:00:00.000Z'}`,
		tenantId: overrides.tenantId ?? 't-1',
		plan: overrides.plan ?? LICENSE_PLAN.MONTHLY,
		status: overrides.status ?? LICENSE_KEY_STATUS.ACTIVE,
		createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
		...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
		...(overrides.kind ? { kind: overrides.kind } : {}),
		...(overrides.issuedBy ? { issuedBy: overrides.issuedBy } : {}),
		...(overrides.consumedBy ? { consumedBy: overrides.consumedBy } : {}),
		...(overrides.consumedAt ? { consumedAt: overrides.consumedAt } : {}),
		...(overrides.revokedAt ? { revokedAt: overrides.revokedAt } : {}),
		...(overrides.revokedReason ? { revokedReason: overrides.revokedReason } : {}),
		...(overrides.revokedBy ? { revokedBy: overrides.revokedBy } : {}),
	};
}

describe('DynamoDB auth-repo — license key search (#816)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('listLicenseKeysByTenant', () => {
		it('テナントのライセンスキー一覧を返す', async () => {
			const items = [
				makeLicenseItem({
					licenseKey: 'GQ-AAAA-BBBB-CCCC',
					tenantId: 't-1',
					createdAt: '2026-04-02T00:00:00.000Z',
				}),
				makeLicenseItem({
					licenseKey: 'GQ-DDDD-EEEE-FFFF',
					tenantId: 't-1',
					createdAt: '2026-04-01T00:00:00.000Z',
				}),
			];
			mockSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listLicenseKeysByTenant('t-1');

			expect(result.items).toHaveLength(2);
			expect(result.items[0]?.licenseKey).toBe('GQ-AAAA-BBBB-CCCC');
			expect(result.items[1]?.licenseKey).toBe('GQ-DDDD-EEEE-FFFF');
			expect(result.cursor).toBeNull();
		});

		it('ページネーションカーソルを返す', async () => {
			const lastKey = {
				PK: 'LICENSE#GQ-XXXX',
				SK: 'META',
				GSI2PK: 'TENANT#t-1',
				GSI2SK: 'LICENSE#2026-04-01',
			};
			mockSend.mockResolvedValueOnce({
				Items: [makeLicenseItem({ licenseKey: 'GQ-AAAA-BBBB-CCCC' })],
				LastEvaluatedKey: lastKey,
			});

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listLicenseKeysByTenant('t-1', 1);

			expect(result.items).toHaveLength(1);
			expect(result.cursor).toBeTruthy();
			expect(typeof result.cursor).toBe('string');
		});

		it('空のテナントには空配列を返す', async () => {
			mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listLicenseKeysByTenant('t-empty');

			expect(result.items).toHaveLength(0);
			expect(result.cursor).toBeNull();
		});
	});

	describe('listLicenseKeysByStatus', () => {
		it('指定ステータスのキー一覧を返す', async () => {
			const items = [
				makeLicenseItem({ licenseKey: 'GQ-AAAA-BBBB-CCCC', status: LICENSE_KEY_STATUS.ACTIVE }),
			];
			mockSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listLicenseKeysByStatus(LICENSE_KEY_STATUS.ACTIVE);

			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.status).toBe(LICENSE_KEY_STATUS.ACTIVE);
			expect(result.cursor).toBeNull();
		});

		it('revoked ステータスでフィルタリングできる', async () => {
			const items = [
				makeLicenseItem({
					licenseKey: 'GQ-RRRR-RRRR-RRRR',
					status: LICENSE_KEY_STATUS.REVOKED,
					revokedAt: '2026-04-10T00:00:00.000Z',
					revokedReason: 'ops-manual',
					revokedBy: 'ops:admin',
				}),
			];
			mockSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listLicenseKeysByStatus(LICENSE_KEY_STATUS.REVOKED);

			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.revokedReason).toBe('ops-manual');
		});
	});

	describe('listExpiringSoon', () => {
		it('期限切れ間近のキーを返す', async () => {
			const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
			const items = [
				makeLicenseItem({
					licenseKey: 'GQ-EEEE-EEEE-EEEE',
					status: LICENSE_KEY_STATUS.ACTIVE,
					expiresAt: soon,
				}),
			];
			mockSend.mockResolvedValueOnce({ Items: items, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listExpiringSoon(7);

			expect(result).toHaveLength(1);
			expect(result[0]?.licenseKey).toBe('GQ-EEEE-EEEE-EEEE');
		});

		it('期限切れキーがない場合は空配列を返す', async () => {
			mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.listExpiringSoon(7);

			expect(result).toHaveLength(0);
		});
	});

	describe('countLicenseKeys', () => {
		it('全キーの数を返す', async () => {
			mockSend.mockResolvedValueOnce({ Count: 42, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.countLicenseKeys();

			expect(result).toBe(42);
		});

		it('テナントフィルタ付きで数を返す', async () => {
			mockSend.mockResolvedValueOnce({ Count: 5, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.countLicenseKeys({ tenantId: 't-1' });

			expect(result).toBe(5);
		});

		it('ステータスフィルタ付きで数を返す', async () => {
			mockSend.mockResolvedValueOnce({ Count: 10, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.countLicenseKeys({ status: LICENSE_KEY_STATUS.ACTIVE });

			expect(result).toBe(10);
		});

		it('テナント + ステータスフィルタの組み合わせ', async () => {
			mockSend.mockResolvedValueOnce({ Count: 3, LastEvaluatedKey: undefined });

			const mod = await import('$lib/server/db/dynamodb/auth-repo');
			const result = await mod.countLicenseKeys({
				tenantId: 't-1',
				status: LICENSE_KEY_STATUS.CONSUMED,
			});

			expect(result).toBe(3);
		});
	});
});

// ============================================================
// decodeCursor security (#816 QA review)
// ============================================================

describe('DynamoDB auth-repo — decodeCursor security (#816)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('不正な Base64 カーソル文字列でエラーをスローする', async () => {
		const mod = await import('$lib/server/db/dynamodb/auth-repo');
		await expect(mod.listLicenseKeysByTenant('t-1', 10, 'not-valid-base64!!!')).rejects.toThrow(
			'Invalid pagination cursor',
		);
	});

	it('配列をデコードした場合もエラーをスローする', async () => {
		const arrayCursor = Buffer.from(JSON.stringify([1, 2, 3]), 'utf-8').toString('base64url');
		const mod = await import('$lib/server/db/dynamodb/auth-repo');
		await expect(mod.listLicenseKeysByTenant('t-1', 10, arrayCursor)).rejects.toThrow(
			'Invalid pagination cursor',
		);
	});

	it('null をデコードした場合もエラーをスローする', async () => {
		const nullCursor = Buffer.from('null', 'utf-8').toString('base64url');
		const mod = await import('$lib/server/db/dynamodb/auth-repo');
		await expect(mod.listLicenseKeysByTenant('t-1', 10, nullCursor)).rejects.toThrow(
			'Invalid pagination cursor',
		);
	});
});
