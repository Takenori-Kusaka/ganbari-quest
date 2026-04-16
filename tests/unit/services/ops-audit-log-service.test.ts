// tests/unit/services/ops-audit-log-service.test.ts
// #820 監査ログサービスのユニットテスト

import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../../src/lib/server/auth/types';
import type {
	InsertOpsAuditLogInput,
	OpsAuditLogRow,
} from '../../../src/lib/server/db/interfaces/ops-audit-log-repo.interface';

const mockInsert = vi.fn<(input: InsertOpsAuditLogInput) => Promise<void>>();
const mockFindRecent = vi.fn<(limit: number) => Promise<OpsAuditLogRow[]>>();
const mockFindByActor = vi.fn<(actorId: string, limit: number) => Promise<OpsAuditLogRow[]>>();
const mockLoggerError = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		opsAuditLog: {
			insert: (i: InsertOpsAuditLogInput) => mockInsert(i),
			findRecent: (n: number) => mockFindRecent(n),
			findByActor: (a: string, n: number) => mockFindByActor(a, n),
		},
	}),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { error: (...args: unknown[]) => mockLoggerError(...args), info: vi.fn(), warn: vi.fn() },
}));

import {
	listAuditsByActor,
	listRecentAudits,
	recordOpsAudit,
} from '../../../src/lib/server/services/ops-audit-log-service';

function makeCognitoIdentity(overrides: Partial<{ userId: string; email: string }> = {}): Identity {
	return {
		type: 'cognito',
		userId: overrides.userId ?? 'cog-user-1',
		email: overrides.email ?? 'ops@example.com',
	};
}

function makeLocalIdentity(): Identity {
	return { type: 'local' };
}

function makeEvent(opts: { ip?: string | null; ua?: string | null; xff?: string | null } = {}) {
	const headers = new Headers();
	if (opts.ua !== null && opts.ua !== undefined) headers.set('user-agent', opts.ua);
	if (opts.xff !== null && opts.xff !== undefined) headers.set('x-forwarded-for', opts.xff);
	return {
		request: { headers },
		getClientAddress: () => {
			if (opts.ip === null) throw new Error('no ip');
			return opts.ip ?? '127.0.0.1';
		},
	} as unknown as RequestEvent;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockInsert.mockResolvedValue(undefined);
});

describe('recordOpsAudit', () => {
	it('cognito identity から actorId/actorEmail を抽出して insert する', async () => {
		await recordOpsAudit({
			identity: makeCognitoIdentity({ userId: 'u-42', email: 'admin@example.com' }),
			event: makeEvent({ ip: '203.0.113.10', ua: 'Mozilla/5.0 test' }),
			action: 'tenant.suspend',
			target: 'tenant-xyz',
			metadata: { reason: 'payment-failed' },
		});

		expect(mockInsert).toHaveBeenCalledTimes(1);
		const arg = mockInsert.mock.calls[0]?.[0];
		expect(arg.actorId).toBe('u-42');
		expect(arg.actorEmail).toBe('admin@example.com');
		expect(arg.ip).toBe('203.0.113.10');
		expect(arg.ua).toBe('Mozilla/5.0 test');
		expect(arg.action).toBe('tenant.suspend');
		expect(arg.target).toBe('tenant-xyz');
		expect(arg.metadata).toEqual({ reason: 'payment-failed' });
	});

	it('local identity は actorId=local / actorEmail=local@localhost で記録される', async () => {
		await recordOpsAudit({
			identity: makeLocalIdentity(),
			event: makeEvent({ ip: '192.168.1.2', ua: 'curl/8.0' }),
			action: 'ping',
		});

		const arg = mockInsert.mock.calls[0]?.[0];
		expect(arg.actorId).toBe('local');
		expect(arg.actorEmail).toBe('local@localhost');
	});

	it('target/metadata 未指定の場合は null が渡される', async () => {
		await recordOpsAudit({
			identity: makeCognitoIdentity(),
			event: makeEvent(),
			action: 'kpi.view',
		});

		const arg = mockInsert.mock.calls[0]?.[0];
		expect(arg.target).toBeNull();
		expect(arg.metadata).toBeNull();
	});

	it('getClientAddress が throw した場合は x-forwarded-for の先頭 IP をフォールバックに使う', async () => {
		await recordOpsAudit({
			identity: makeCognitoIdentity(),
			event: makeEvent({ ip: null, xff: '198.51.100.7, 10.0.0.1', ua: 'ua-x' }),
			action: 'login',
		});

		const arg = mockInsert.mock.calls[0]?.[0];
		expect(arg.ip).toBe('198.51.100.7');
	});

	it('IP/UA が取得できない場合は null で記録される', async () => {
		await recordOpsAudit({
			identity: makeCognitoIdentity(),
			event: makeEvent({ ip: null }),
			action: 'login',
		});

		const arg = mockInsert.mock.calls[0]?.[0];
		expect(arg.ip).toBeNull();
		expect(arg.ua).toBeNull();
	});

	it('insert が throw しても呼び出し元には例外を伝播させず logger.error に記録する', async () => {
		mockInsert.mockRejectedValueOnce(new Error('db down'));

		await expect(
			recordOpsAudit({
				identity: makeCognitoIdentity(),
				event: makeEvent(),
				action: 'tenant.suspend',
			}),
		).resolves.toBeUndefined();

		expect(mockLoggerError).toHaveBeenCalledTimes(1);
	});
});

describe('listRecentAudits', () => {
	it('findRecent の結果を OpsAuditLogEntry 形式で返し metadata JSON をパースする', async () => {
		mockFindRecent.mockResolvedValueOnce([
			{
				id: 2,
				actorId: 'u-1',
				actorEmail: 'a@example.com',
				ip: '127.0.0.1',
				ua: 'ua',
				action: 'tenant.suspend',
				target: 't-1',
				metadata: JSON.stringify({ reason: 'x' }),
				createdAt: '2026-04-15T00:00:00Z',
			},
			{
				id: 1,
				actorId: 'u-2',
				actorEmail: 'b@example.com',
				ip: null,
				ua: null,
				action: 'login',
				target: null,
				metadata: null,
				createdAt: '2026-04-14T00:00:00Z',
			},
		]);

		const result = await listRecentAudits(50);

		expect(mockFindRecent).toHaveBeenCalledWith(50);
		expect(result).toHaveLength(2);
		expect(result[0]?.metadata).toEqual({ reason: 'x' });
		expect(result[1]?.metadata).toBeNull();
	});

	it('不正な JSON metadata は null に変換される', async () => {
		mockFindRecent.mockResolvedValueOnce([
			{
				id: 1,
				actorId: 'u-1',
				actorEmail: 'a@example.com',
				ip: null,
				ua: null,
				action: 'x',
				target: null,
				metadata: '{broken',
				createdAt: '2026-04-15T00:00:00Z',
			},
		]);

		const result = await listRecentAudits(10);
		expect(result[0]?.metadata).toBeNull();
	});

	it('limit 省略時は 100 を渡す', async () => {
		mockFindRecent.mockResolvedValueOnce([]);
		await listRecentAudits();
		expect(mockFindRecent).toHaveBeenCalledWith(100);
	});
});

describe('listAuditsByActor', () => {
	it('findByActor に actorId と limit を委譲する', async () => {
		mockFindByActor.mockResolvedValueOnce([]);
		await listAuditsByActor('u-99', 20);
		expect(mockFindByActor).toHaveBeenCalledWith('u-99', 20);
	});
});
