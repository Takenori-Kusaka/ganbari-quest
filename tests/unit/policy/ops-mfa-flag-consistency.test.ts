// tests/unit/policy/ops-mfa-flag-consistency.test.ts
// #4363: /ops の MFA 要求は **1 箇所のフラグ** (`OPS_MFA_REQUIRED`) で決まり、
//        実強制点 (ops-authz.ts) と policy 層の写像 (capabilities.ts) が食い違わないことを固定する。
//
// なぜ必要か: MFA 判定は 2 箇所にある。
//   - 実強制点: `hasOpsAccess()` / `requireOpsAccess()` (src/lib/server/auth/ops-authz.ts)
//   - policy 層の写像: `can(ctx, 'access.ops_dashboard')` (src/lib/policy/capabilities.ts)
// 片方だけを外すと「UI は入れると言うが load は 403」/ その逆が起き、再評価トリガーで
// 戻すときにも片方だけ戻る。したがって**同一定数を両者が import している**ことを
// ソース構造レベルで assert する (真偽値の二重定義を作らせない)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Capability, can, OPS_MFA_REQUIRED } from '../../../src/lib/policy/capabilities';
import { buildEvaluationContext } from '../../../src/lib/runtime/evaluation-context';

const REPO_ROOT = join(import.meta.dirname, '../../..');

const opsCaps: Capability[] = ['access.ops_dashboard', 'view.ops_license_dashboard'];

function ctxFor(user: { id: string; groups: string[]; mfaAuthenticated?: boolean }) {
	return buildEvaluationContext({
		mode: 'aws-prod',
		user: {
			id: user.id,
			role: 'owner',
			groups: user.groups,
			mfaAuthenticated: user.mfaAuthenticated,
		},
		plan: null,
	});
}

describe('#4363 policy 層も MFA を要求しない (実強制点と同じ判断)', () => {
	for (const cap of opsCaps) {
		it(`${cap}: MFA 未設定の ops group は allowed`, () => {
			expect(can(ctxFor({ id: 'u-ops-no-mfa', groups: ['ops'] }), cap)).toEqual({ allowed: true });
		});

		it(`${cap}: mfaAuthenticated=false の ops group も allowed`, () => {
			expect(
				can(ctxFor({ id: 'u-ops-false', groups: ['ops'], mfaAuthenticated: false }), cap),
			).toEqual({ allowed: true });
		});

		it(`${cap}: 非 ops は従来どおり ops-only で拒否 (緩めない)`, () => {
			expect(can(ctxFor({ id: 'u-parent', groups: [], mfaAuthenticated: true }), cap)).toEqual({
				allowed: false,
				reason: 'ops-only',
			});
		});
	}
});

describe('#4363 フラグの単一 SSOT (実強制点 / policy 層が同じ定数を読む)', () => {
	it('OPS_MFA_REQUIRED は capabilities.ts が 1 度だけ定義する', () => {
		const src = readFileSync(join(REPO_ROOT, 'src/lib/policy/capabilities.ts'), 'utf8');
		const defs = src.match(/export const OPS_MFA_REQUIRED\b/g) ?? [];
		expect(defs).toHaveLength(1);
	});

	it('ops-authz.ts は自前の真偽値を持たず、capabilities.ts の定数を import する', () => {
		const src = readFileSync(join(REPO_ROOT, 'src/lib/server/auth/ops-authz.ts'), 'utf8');
		expect(src).toMatch(
			/import\s*\{[^}]*OPS_MFA_REQUIRED[^}]*\}\s*from\s*'\$lib\/policy\/capabilities'/s,
		);
		// 別の名前で二重定義していないこと (`const requireMfa = false` のような握り潰し)
		expect(src).not.toMatch(/const\s+OPS_MFA_REQUIRED\s*=/);
	});

	it('capabilities.ts の ops 判定はフラグ経由でのみ MFA を見る', () => {
		const src = readFileSync(join(REPO_ROOT, 'src/lib/policy/capabilities.ts'), 'utf8');
		const opsGuard = src.slice(src.indexOf('function requireOpsGroup'));
		const body = opsGuard.slice(0, opsGuard.indexOf('\n}'));
		if (body.includes('mfaAuthenticated')) {
			expect(body).toContain('OPS_MFA_REQUIRED');
		}
	});

	it('フラグは boolean で、現在の値は false (決裁の状態)', () => {
		expect(typeof OPS_MFA_REQUIRED).toBe('boolean');
		expect(OPS_MFA_REQUIRED).toBe(false);
	});
});
