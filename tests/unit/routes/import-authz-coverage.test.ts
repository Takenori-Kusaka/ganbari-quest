// tests/unit/routes/import-authz-coverage.test.ts
// #3334: データ import / 復元の認可網羅性の回帰固定。
//
// ROUTE_RULES の /api/v1 は owner / parent / child すべての到達を許すため、家族データを
// 取り込む管理操作 endpoint は in-handler で owner / parent に絞る必要がある。
//
// 観点:
// - /api/v1/activities/import: child → 403 (本 PR で追加した gate)、owner / parent は gate 通過
// - /api/v1/import (ファイル取込): child → 403 (既存 requireRole 防御の回帰固定)、
//   owner / parent は role gate を通過し後段 (body 検証) に進む
//
// tenant 境界 / IDOR (CWE-639) の防御は別テストで固定済:
// - import-cloud-template-per-child.test.ts: cross-tenant child id 拒否
// - importFamilyData は server 由来 tenantId + childRef→新規 child remap で他テナント注入を排除

import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// activities/import は marketplace registry / dispatchImport を使う。owner/parent の gate 通過を
// preview で確認するため軽量スタブに差し替える (DB 非依存)。
const mockPreview = vi.fn();
vi.mock('$lib/marketplace', () => ({
	marketplaceRegistry: {
		get: () => ({
			strategy: {
				parse: (raw: unknown) => raw,
				preview: (...args: unknown[]) => mockPreview(...args),
			},
		}),
	},
	dispatchImport: vi.fn(),
}));

const { POST: activitiesImport } = await import(
	'../../../src/routes/api/v1/activities/import/+server'
);
const { POST: fileImport } = await import('../../../src/routes/api/v1/import/+server');

type Role = 'owner' | 'parent' | 'child';

function activitiesEvent(role: Role, mode = 'preview') {
	return {
		request: new Request(`http://localhost/api/v1/activities/import?mode=${mode}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ activities: [{ name: 'はしる', categoryCode: 'undou' }] }),
		}),
		url: new URL(`http://localhost/api/v1/activities/import?mode=${mode}`),
		locals: {
			context: { tenantId: 't-test', role },
			identity: { type: 'cognito', userId: 'u-caller' },
		},
	} as unknown as Parameters<NonNullable<typeof activitiesImport>>[0];
}

function fileImportEvent(role: Role) {
	// body は空 (invalid JSON)。role gate を通過すると parseImportRequest の JSON 解析で
	// VALIDATION_ERROR (Response) になる → 「403 で止まらず後段に進んだ」ことの証跡。
	return {
		request: new Request('http://localhost/api/v1/import?mode=preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json',
		}),
		url: new URL('http://localhost/api/v1/import?mode=preview'),
		locals: {
			context: { tenantId: 't-test', role },
			identity: { type: 'cognito', userId: 'u-caller' },
		},
	} as unknown as Parameters<NonNullable<typeof fileImport>>[0];
}

describe('データ import / 復元の認可網羅性 (#3334)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPreview.mockResolvedValue({
			total: 1,
			newItems: 1,
			duplicates: 0,
			duplicateNames: [],
			byCategory: {},
		});
	});

	describe('POST /api/v1/activities/import (家族の活動取込)', () => {
		it('child は 403 で拒否される (本 PR で追加した owner-gate)', async () => {
			await expect(activitiesImport(activitiesEvent('child'))).rejects.toSatisfy((e: unknown) =>
				isHttpError(e, 403),
			);
			expect(mockPreview).not.toHaveBeenCalled();
		});

		for (const role of ['owner', 'parent'] as const) {
			it(`${role} は gate を通過し取込 preview に進む`, async () => {
				const res = await activitiesImport(activitiesEvent(role));
				expect(res.status).toBe(200);
				expect(mockPreview).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({ tenantId: 't-test' }),
				);
			});
		}
	});

	describe('POST /api/v1/import (バックアップファイル取込)', () => {
		it('child は 403 で拒否される (既存 requireRole 防御の回帰固定)', async () => {
			await expect(fileImport(fileImportEvent('child'))).rejects.toSatisfy((e: unknown) =>
				isHttpError(e, 403),
			);
		});

		for (const role of ['owner', 'parent'] as const) {
			it(`${role} は role gate を通過し後段 (body 検証) に進む (403 で止まらない)`, async () => {
				// 通過後 invalid JSON body で VALIDATION_ERROR (Response) になる = gate を越えた証跡。
				const res = await fileImport(fileImportEvent(role));
				expect(res).toBeInstanceOf(Response);
				expect(res.status).not.toBe(403);
				expect(res.status).not.toBe(401);
			});
		}
	});
});
