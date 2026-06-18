// tests/integration/api/tenant-static-file-idor.test.ts
// #3133: /tenants/[...path] + /uploads/avatars/[filename] の cross-tenant IDOR ハンドラ層回帰テスト。
// 認証済ユーザが他テナントの静的ファイルを GET できないこと（tenant 一致しない → 404）を検証する。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '../../helpers/mock-event';

// storage / child-service を mock（IDOR guard は storage / DB 到達前に効くべき）
vi.mock('../../../src/lib/server/storage', () => ({ readFile: vi.fn() }));
vi.mock('$lib/server/storage', () => ({ readFile: vi.fn() }));
vi.mock('../../../src/lib/server/services/child-service', () => ({ getChildById: vi.fn() }));
vi.mock('$lib/server/services/child-service', () => ({ getChildById: vi.fn() }));

import { getChildById } from '$lib/server/services/child-service';
import { readFile } from '$lib/server/storage';
import { GET as tenantsGET } from '../../../src/routes/tenants/[...path]/+server';
import { GET as avatarsGET } from '../../../src/routes/uploads/avatars/[filename]/+server';

const readFileMock = vi.mocked(readFile);
const getChildByIdMock = vi.mocked(getChildById);

/** ハンドラ呼び出しで throw された HttpError の status を取り出す（throw しなければ null） */
async function statusOf(result: unknown): Promise<number | null> {
	try {
		await result;
		return null;
	} catch (e) {
		return (e as { status?: number }).status ?? -1;
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	readFileMock.mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: 'image/png' });
	// biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 Child スタブ
	getChildByIdMock.mockResolvedValue({ id: 1, tenantId: 't-self' } as any);
});

describe('#3133 /tenants/[...path] cross-tenant IDOR guard', () => {
	it('他テナントの path（先頭セグメント不一致）は 404、storage に到達しない', async () => {
		const event = createMockEvent({
			url: '/tenants/t-other/avatars/1/x.png',
			params: { path: 't-other/avatars/1/x.png' },
			context: { tenantId: 't-self', role: 'owner' },
		});
		expect(await statusOf(tenantsGET(event))).toBe(404);
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('未認証（context=null）は 404', async () => {
		const event = createMockEvent({
			url: '/tenants/t-self/avatars/1/x.png',
			params: { path: 't-self/avatars/1/x.png' },
			context: null,
		});
		expect(await statusOf(tenantsGET(event))).toBe(404);
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('自テナントの path は配信される（storage に到達）', async () => {
		const event = createMockEvent({
			url: '/tenants/t-self/avatars/1/x.png',
			params: { path: 't-self/avatars/1/x.png' },
			context: { tenantId: 't-self', role: 'child' },
		});
		const res = (await tenantsGET(event)) as Response;
		expect(res.status).toBe(200);
		expect(readFileMock).toHaveBeenCalledWith('tenants/t-self/avatars/1/x.png');
	});

	it('path traversal（..）は 400（既存防御を維持）', async () => {
		const event = createMockEvent({
			url: '/tenants/t-self/../t-other/x.png',
			params: { path: 't-self/../t-other/x.png' },
			context: { tenantId: 't-self', role: 'owner' },
		});
		expect(await statusOf(tenantsGET(event))).toBe(400);
	});
});

describe('#3133 /uploads/avatars/[filename] legacy cross-tenant IDOR guard', () => {
	it('childId が自テナントの子供でない（getChildById=undefined）は 404、storage に到達しない', async () => {
		getChildByIdMock.mockResolvedValue(undefined);
		const event = createMockEvent({
			url: '/uploads/avatars/avatar-999-abc.png',
			params: { filename: 'avatar-999-abc.png' },
			context: { tenantId: 't-self', role: 'owner' },
		});
		expect(await statusOf(avatarsGET(event))).toBe(404);
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('legacy 命名（avatar-<childId>-）に合致しない filename は 404', async () => {
		const event = createMockEvent({
			url: '/uploads/avatars/random.png',
			params: { filename: 'random.png' },
			context: { tenantId: 't-self', role: 'owner' },
		});
		expect(await statusOf(avatarsGET(event))).toBe(404);
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('未認証（context=null）は 404', async () => {
		const event = createMockEvent({
			url: '/uploads/avatars/avatar-1-abc.png',
			params: { filename: 'avatar-1-abc.png' },
			context: null,
		});
		expect(await statusOf(avatarsGET(event))).toBe(404);
		expect(readFileMock).not.toHaveBeenCalled();
	});

	it('childId が自テナントの子供なら配信される（getChildById で tenant scope 検証）', async () => {
		const event = createMockEvent({
			url: '/uploads/avatars/avatar-1-abc.png',
			params: { filename: 'avatar-1-abc.png' },
			context: { tenantId: 't-self', role: 'parent' },
		});
		const res = (await avatarsGET(event)) as Response;
		expect(res.status).toBe(200);
		expect(getChildByIdMock).toHaveBeenCalledWith(1, 't-self');
		expect(readFileMock).toHaveBeenCalledWith('uploads/avatars/avatar-1-abc.png');
	});
});
