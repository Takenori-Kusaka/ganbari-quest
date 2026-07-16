// tests/unit/auth/owner-gate.test.ts
// #3561 (#3558 follow-up): owner-gate seam 共通 Response 変換 helper
// (src/lib/server/auth/owner-gate.ts ownerGateResponse) の直接検証。
//
// テスト観点:
// - ① 403: 非 owner は呼び出し側指定の文言 (OWNER_GATE_LABELS SSOT) で 403 JSON
// - ③ 401: 認証 context 欠落 (requireRole が throw する HttpError(401)) は
//   500 化させず `{error: 認証が必要です}` 401 JSON へ変換する (機械検証)
// - owner は null (続行可)
// - HttpError(401/403) 以外の例外は re-throw (握りつぶさない)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OWNER_GATE_LABELS } from '../../../src/lib/domain/labels';
import { ownerGateResponse } from '../../../src/lib/server/auth/owner-gate';

// #3552 ②: 403 拒否の監査ログ検証のため logger を spy 化する
const loggerWarn = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: (...a: unknown[]) => loggerWarn(...a),
		error: vi.fn(),
	},
}));

type Role = 'owner' | 'parent' | 'child';

function createLocals(role: Role | null, opts: { userId?: string } = {}): App.Locals {
	return {
		context: role ? { tenantId: 't-test', role } : null,
		identity: opts.userId ? { type: 'cognito', userId: opts.userId } : undefined,
	} as unknown as App.Locals;
}

beforeEach(() => {
	loggerWarn.mockClear();
});

describe('ownerGateResponse (#3561 owner-gate seam hardening)', () => {
	it('owner は null を返し続行可 (positive)', () => {
		expect(ownerGateResponse(createLocals('owner'), OWNER_GATE_LABELS.accountDelete)).toBeNull();
	});

	for (const role of ['parent', 'child'] as const) {
		it(`${role} は 403 + 呼び出し側指定の {error} body (① SSOT 文言)`, async () => {
			const res = ownerGateResponse(createLocals(role), OWNER_GATE_LABELS.tenantCancel);
			expect(res).not.toBeNull();
			expect(res?.status).toBe(403);
			await expect(res?.json()).resolves.toEqual({ error: OWNER_GATE_LABELS.tenantCancel });
		});
	}

	it('認証 context 欠落は 500 化せず 401 + {error: 認証が必要です} に変換される (③ 401 伝播頑健化)', async () => {
		// requireRole は !locals.context で HttpError(401) を throw する。
		// 上流の `!context` 早期 return が将来消えても、本 helper が 401 JSON に
		// 変換するため outer try/catch での 500 化 (潜在退行) が起きないことを機械検証。
		const res = ownerGateResponse(createLocals(null), OWNER_GATE_LABELS.accountDelete);
		expect(res).not.toBeNull();
		expect(res?.status).toBe(401);
		await expect(res?.json()).resolves.toEqual({ error: OWNER_GATE_LABELS.authRequired });
	});

	// #3552 ②: role-mutation 拒否の監査ログ
	describe('403 拒否の監査ログ (#3552 ②)', () => {
		it('audit 指定時、403 拒否は logger.warn に actor / role / tenant / target を記録する', () => {
			const res = ownerGateResponse(
				createLocals('parent', { userId: 'u-attacker' }),
				OWNER_GATE_LABELS.transferOwnership,
				{ auditAction: 'members.transfer-ownership', targetId: 'u-victim' },
			);
			expect(res?.status).toBe(403);
			expect(loggerWarn).toHaveBeenCalledTimes(1);
			expect(loggerWarn).toHaveBeenCalledWith(
				expect.stringContaining('owner-gate'),
				expect.objectContaining({
					context: expect.objectContaining({
						action: 'members.transfer-ownership',
						tenantId: 't-test',
						actorUserId: 'u-attacker',
						actorRole: 'parent',
						targetId: 'u-victim',
					}),
				}),
			);
		});

		it('audit 未指定時は 403 でも監査ログを残さない (account / tenant 系は対象外)', () => {
			const res = ownerGateResponse(createLocals('parent'), OWNER_GATE_LABELS.tenantCancel);
			expect(res?.status).toBe(403);
			expect(loggerWarn).not.toHaveBeenCalled();
		});

		it('owner 成功時は audit 指定でも監査ログを残さない', () => {
			ownerGateResponse(
				createLocals('owner', { userId: 'u-owner' }),
				OWNER_GATE_LABELS.memberDelete,
				{
					auditAction: 'members.delete',
					targetId: 'u-target',
				},
			);
			expect(loggerWarn).not.toHaveBeenCalled();
		});
	});

	it('401/403 の HttpError 以外は re-throw する (握りつぶし禁止)', () => {
		// requireRole を通常経路で通過させず、locals 参照自体が失敗する異常系を模す。
		// (context getter が throw する = HttpError ではない例外)
		const broken = {
			get context(): never {
				throw new Error('unexpected non-http error');
			},
		} as unknown as App.Locals;
		expect(() => ownerGateResponse(broken, OWNER_GATE_LABELS.accountDelete)).toThrowError(
			'unexpected non-http error',
		);
	});
});
