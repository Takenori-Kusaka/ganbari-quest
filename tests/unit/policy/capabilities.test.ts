import { describe, expect, it } from 'vitest';

import { type Capability, can, ensureCan } from '$lib/policy/capabilities';
import {
	buildEvaluationContext,
	type EvaluationContext,
	type EvaluationPlan,
	type EvaluationUser,
} from '$lib/runtime/evaluation-context';

const owner: EvaluationUser = { id: 'u-owner', role: 'owner', groups: [] };
const parent: EvaluationUser = { id: 'u-parent', role: 'parent', groups: [] };
const child: EvaluationUser = { id: 'u-child', role: 'child', groups: [] };
const opsOwner: EvaluationUser = { id: 'u-ops', role: 'owner', groups: ['ops'] };

const family: EvaluationPlan = { tier: 'family', status: 'active', trialState: 'none' };
const standard: EvaluationPlan = { tier: 'standard', status: 'active', trialState: 'none' };
const free: EvaluationPlan = { tier: 'free', status: 'none', trialState: 'none' };

function ctx(
	overrides: Partial<Omit<EvaluationContext, 'mode'>> & { mode: EvaluationContext['mode'] },
): EvaluationContext {
	return buildEvaluationContext({
		mode: overrides.mode,
		user: overrides.user ?? null,
		plan: overrides.plan ?? null,
		now: overrides.now,
	});
}

describe('policy/capabilities can() — write.db', () => {
	it('local-debug + user = allowed', () => {
		expect(can(ctx({ mode: 'local-debug', user: owner }), 'write.db')).toEqual({ allowed: true });
	});

	it('demo = demo-readonly', () => {
		expect(can(ctx({ mode: 'demo' }), 'write.db')).toEqual({
			allowed: false,
			reason: 'demo-readonly',
		});
	});

	it('build = build-time-readonly', () => {
		expect(can(ctx({ mode: 'build' }), 'write.db')).toEqual({
			allowed: false,
			reason: 'build-time-readonly',
		});
	});

	// #2813 (Epic #2525 Phase 7 PR-L2): license key 全廃。NUC は信頼ベースで
	// licenseKey に依存せず常時 write 可能 (phase1-nuc FR-2 / US-N3 = NUC が記録不能に
	// ならないことの回帰防止)。
	it('nuc-prod = allowed (license key 無し、信頼ベースで常時 write 可能)', () => {
		expect(can(ctx({ mode: 'nuc-prod', user: owner }), 'write.db')).toEqual({ allowed: true });
	});

	it('nuc-prod + user 無しでも allowed (mode のみで write 可否が決まる)', () => {
		expect(can(ctx({ mode: 'nuc-prod' }), 'write.db')).toEqual({ allowed: true });
	});

	it('aws-prod = allowed (user 不要、共通判定のみ)', () => {
		expect(can(ctx({ mode: 'aws-prod' }), 'write.db')).toEqual({ allowed: true });
	});
});

describe('policy/capabilities can() — record.activity', () => {
	it('aws-prod + user = allowed', () => {
		expect(can(ctx({ mode: 'aws-prod', user: child }), 'record.activity')).toEqual({
			allowed: true,
		});
	});

	it('user=null = unauthenticated', () => {
		expect(can(ctx({ mode: 'aws-prod' }), 'record.activity')).toEqual({
			allowed: false,
			reason: 'unauthenticated',
		});
	});

	it('demo = demo-readonly (write.db 前提を継承)', () => {
		expect(can(ctx({ mode: 'demo', user: child }), 'record.activity')).toEqual({
			allowed: false,
			reason: 'demo-readonly',
		});
	});

	// #2813 (Epic #2525 Phase 7 PR-L2): NUC write 回帰防止 (phase1-nuc US-N3)。
	// 5 年齢モード (baby/preschool/elementary/junior/senior) いずれの子供も NUC で
	// 活動記録が可能であることを保証する。年齢モードは UI 層 (uiMode) の差で、認可は
	// role=child + mode=nuc-prod のみで決まるため、record.activity が NUC で常時許可される
	// ことが「license key 撤廃で記録不能にならない」保証となる。
	it('nuc-prod + child = allowed (license key 無し、子供の活動記録が NUC で常時可能)', () => {
		expect(can(ctx({ mode: 'nuc-prod', user: child }), 'record.activity')).toEqual({
			allowed: true,
		});
	});

	it('nuc-prod + owner / parent / child いずれも記録可能 (5 年齢モード横断の NUC write 保証)', () => {
		for (const user of [owner, parent, child]) {
			expect(
				can(ctx({ mode: 'nuc-prod', user }), 'record.activity'),
				`role=${user.role} が nuc-prod で記録できない`,
			).toEqual({ allowed: true });
		}
	});
});

describe('policy/capabilities can() — invite.family_member', () => {
	it('aws-prod + owner + family = allowed', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: owner, plan: family }), 'invite.family_member'),
		).toEqual({ allowed: true });
	});

	it('parent role = role-insufficient', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: parent, plan: family }), 'invite.family_member'),
		).toEqual({ allowed: false, reason: 'role-insufficient' });
	});

	it('standard plan = plan-tier-insufficient', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: owner, plan: standard }), 'invite.family_member'),
		).toEqual({ allowed: false, reason: 'plan-tier-insufficient' });
	});

	it('free plan = plan-tier-insufficient', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner, plan: free }), 'invite.family_member')).toEqual(
			{ allowed: false, reason: 'plan-tier-insufficient' },
		);
	});

	it('plan=null = plan-tier-insufficient', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner }), 'invite.family_member')).toEqual({
			allowed: false,
			reason: 'plan-tier-insufficient',
		});
	});

	it('user=null = unauthenticated', () => {
		expect(can(ctx({ mode: 'aws-prod', plan: family }), 'invite.family_member')).toEqual({
			allowed: false,
			reason: 'unauthenticated',
		});
	});

	it('demo = demo-readonly (write.db 継承)', () => {
		expect(can(ctx({ mode: 'demo', user: owner, plan: family }), 'invite.family_member')).toEqual({
			allowed: false,
			reason: 'demo-readonly',
		});
	});
});

describe('policy/capabilities can() — export.activity_history', () => {
	it('owner + standard = allowed', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: owner, plan: standard }), 'export.activity_history'),
		).toEqual({ allowed: true });
	});

	it('parent + family = allowed', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: parent, plan: family }), 'export.activity_history'),
		).toEqual({ allowed: true });
	});

	it('child role = role-insufficient', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: child, plan: standard }), 'export.activity_history'),
		).toEqual({ allowed: false, reason: 'role-insufficient' });
	});

	it('free plan = plan-tier-insufficient', () => {
		expect(
			can(ctx({ mode: 'aws-prod', user: owner, plan: free }), 'export.activity_history'),
		).toEqual({ allowed: false, reason: 'plan-tier-insufficient' });
	});
});

describe('policy/capabilities can() — access.ops_dashboard / view.ops_license_dashboard', () => {
	const caps: Capability[] = ['access.ops_dashboard', 'view.ops_license_dashboard'];

	for (const cap of caps) {
		it(`${cap}: ops group = allowed`, () => {
			expect(can(ctx({ mode: 'aws-prod', user: opsOwner }), cap)).toEqual({ allowed: true });
		});

		it(`${cap}: non-ops user = ops-only`, () => {
			expect(can(ctx({ mode: 'aws-prod', user: owner }), cap)).toEqual({
				allowed: false,
				reason: 'ops-only',
			});
		});

		it(`${cap}: user=null = unauthenticated`, () => {
			expect(can(ctx({ mode: 'aws-prod' }), cap)).toEqual({
				allowed: false,
				reason: 'unauthenticated',
			});
		});
	}
});

describe('policy/capabilities can() — purchase.upgrade', () => {
	it('aws-prod + owner + free = allowed', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner, plan: free }), 'purchase.upgrade')).toEqual({
			allowed: true,
		});
	});

	it('aws-prod + owner + standard = allowed (standard→family upgrade)', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner, plan: standard }), 'purchase.upgrade')).toEqual(
			{ allowed: true },
		);
	});

	it('aws-prod + owner + family = plan-tier-insufficient (already top)', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner, plan: family }), 'purchase.upgrade')).toEqual({
			allowed: false,
			reason: 'plan-tier-insufficient',
		});
	});

	it('nuc-prod = mode-mismatch (NUC は Stripe を使わない)', () => {
		expect(can(ctx({ mode: 'nuc-prod', user: owner, plan: free }), 'purchase.upgrade')).toEqual({
			allowed: false,
			reason: 'mode-mismatch',
		});
	});

	it('parent role = role-insufficient', () => {
		expect(can(ctx({ mode: 'aws-prod', user: parent, plan: free }), 'purchase.upgrade')).toEqual({
			allowed: false,
			reason: 'role-insufficient',
		});
	});
});

describe('policy/capabilities can() — debug.plan_override', () => {
	it('local-debug = allowed', () => {
		expect(can(ctx({ mode: 'local-debug' }), 'debug.plan_override')).toEqual({ allowed: true });
	});

	it('aws-prod = dev-only', () => {
		expect(can(ctx({ mode: 'aws-prod' }), 'debug.plan_override')).toEqual({
			allowed: false,
			reason: 'dev-only',
		});
	});

	it('demo = dev-only', () => {
		expect(can(ctx({ mode: 'demo' }), 'debug.plan_override')).toEqual({
			allowed: false,
			reason: 'dev-only',
		});
	});
});

describe('policy/capabilities can() — manage.child_profile', () => {
	it('owner = allowed', () => {
		expect(can(ctx({ mode: 'aws-prod', user: owner }), 'manage.child_profile')).toEqual({
			allowed: true,
		});
	});

	it('parent = allowed', () => {
		expect(can(ctx({ mode: 'aws-prod', user: parent }), 'manage.child_profile')).toEqual({
			allowed: true,
		});
	});

	it('child = role-insufficient', () => {
		expect(can(ctx({ mode: 'aws-prod', user: child }), 'manage.child_profile')).toEqual({
			allowed: false,
			reason: 'role-insufficient',
		});
	});

	it('demo = demo-readonly (write.db 継承)', () => {
		expect(can(ctx({ mode: 'demo', user: owner }), 'manage.child_profile')).toEqual({
			allowed: false,
			reason: 'demo-readonly',
		});
	});
});

// #2813 (Epic #2525 Phase 7 PR-L2): `redeem.license_key` capability は license key 全廃に伴い
// 撤廃済。NUC は信頼ベース (判定なし) のため key 引換機構そのものが存在しない (phase1-nuc FR-3)。

describe('policy/capabilities ensureCan()', () => {
	it('allowed の時は throw しない', () => {
		expect(() =>
			ensureCan(ctx({ mode: 'aws-prod', user: child }), 'record.activity'),
		).not.toThrow();
	});

	it('denied の時は 403 error を throw', () => {
		try {
			ensureCan(ctx({ mode: 'demo' }), 'write.db');
			expect.fail('ensureCan should have thrown');
		} catch (e) {
			const err = e as { status: number; body: { message: string; reason: string } };
			expect(err.status).toBe(403);
			expect(err.body.message).toContain('write.db');
			expect(err.body.reason).toBe('demo-readonly');
		}
	});

	it('reason が DenyReason 値として露出される', () => {
		try {
			ensureCan(ctx({ mode: 'aws-prod', user: parent, plan: family }), 'invite.family_member');
			expect.fail('ensureCan should have thrown');
		} catch (e) {
			const err = e as { body: { reason: string } };
			expect(err.body.reason).toBe('role-insufficient');
		}
	});
});
