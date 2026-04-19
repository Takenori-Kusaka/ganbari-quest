import { describe, expect, it } from 'vitest';

import {
	buildEvaluationContext,
	type EvaluationContext,
	type EvaluationPlan,
	type EvaluationUser,
	getEvaluationContext,
	setEvaluationContext,
} from '$lib/runtime/evaluation-context';
import type { RuntimeMode } from '$lib/runtime/runtime-mode';
import { runWithRequestContext } from '$lib/server/request-context';

describe('runtime/evaluation-context buildEvaluationContext (ADR-0040 P3 / #1215)', () => {
	it('builds a context with mode only and nullable others defaulted', () => {
		const ctx = buildEvaluationContext({ mode: 'local-debug' });
		expect(ctx.mode).toBe('local-debug');
		expect(ctx.user).toBeNull();
		expect(ctx.plan).toBeNull();
		expect(ctx.licenseKey).toBeNull();
		expect(ctx.now).toBeInstanceOf(Date);
	});

	it('returns the exact provided values (pure builder)', () => {
		const now = new Date('2026-04-19T00:00:00Z');
		const user: EvaluationUser = { id: 'user-1', role: 'owner', groups: ['ops'] };
		const plan: EvaluationPlan = { tier: 'family', status: 'active', trialState: 'none' };
		const ctx = buildEvaluationContext({
			mode: 'aws-prod',
			user,
			plan,
			licenseKey: { valid: true, expiresAt: new Date('2027-01-01Z') },
			now,
		});
		expect(ctx.mode).toBe('aws-prod');
		expect(ctx.user).toEqual(user);
		expect(ctx.plan).toEqual(plan);
		expect(ctx.licenseKey).toEqual({ valid: true, expiresAt: new Date('2027-01-01Z') });
		expect(ctx.now).toBe(now);
	});

	it('supports all 5 runtime modes', () => {
		const modes: RuntimeMode[] = ['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod'];
		for (const mode of modes) {
			const ctx = buildEvaluationContext({ mode });
			expect(ctx.mode).toBe(mode);
		}
	});

	it('supports user=null (demo / build / unauthenticated)', () => {
		const ctx = buildEvaluationContext({ mode: 'demo', user: null });
		expect(ctx.user).toBeNull();
	});

	it('supports user with each role', () => {
		const roles: EvaluationUser['role'][] = ['owner', 'parent', 'child'];
		for (const role of roles) {
			const ctx = buildEvaluationContext({
				mode: 'local-debug',
				user: { id: 'u', role, groups: [] },
			});
			expect(ctx.user?.role).toBe(role);
		}
	});

	it('supports plan=null (unauthenticated / demo)', () => {
		const ctx = buildEvaluationContext({ mode: 'demo', plan: null });
		expect(ctx.plan).toBeNull();
	});

	it('supports each plan tier', () => {
		const tiers: EvaluationPlan['tier'][] = ['free', 'standard', 'family'];
		for (const tier of tiers) {
			const ctx = buildEvaluationContext({
				mode: 'aws-prod',
				plan: { tier, status: 'active', trialState: 'none' },
			});
			expect(ctx.plan?.tier).toBe(tier);
		}
	});

	it('supports each plan status', () => {
		const statuses: EvaluationPlan['status'][] = ['none', 'active', 'grace_period', 'canceled'];
		for (const status of statuses) {
			const ctx = buildEvaluationContext({
				mode: 'aws-prod',
				plan: { tier: 'standard', status, trialState: 'none' },
			});
			expect(ctx.plan?.status).toBe(status);
		}
	});

	it('supports each trialState', () => {
		const states: EvaluationPlan['trialState'][] = ['none', 'active', 'expired'];
		for (const trialState of states) {
			const ctx = buildEvaluationContext({
				mode: 'local-debug',
				plan: { tier: 'standard', status: 'none', trialState },
			});
			expect(ctx.plan?.trialState).toBe(trialState);
		}
	});

	it('accepts licenseKey with valid=true/false and expiresAt', () => {
		const expires = new Date('2030-01-01Z');
		const ctxValid = buildEvaluationContext({
			mode: 'nuc-prod',
			licenseKey: { valid: true, expiresAt: expires },
		});
		expect(ctxValid.licenseKey).toEqual({ valid: true, expiresAt: expires });

		const ctxInvalid = buildEvaluationContext({
			mode: 'nuc-prod',
			licenseKey: { valid: false, expiresAt: null },
		});
		expect(ctxInvalid.licenseKey).toEqual({ valid: false, expiresAt: null });
	});

	it('now defaults to a fresh Date, but can be injected for test stabilization', () => {
		const fixed = new Date('2026-01-01T12:34:56Z');
		const ctx = buildEvaluationContext({ mode: 'local-debug', now: fixed });
		expect(ctx.now).toBe(fixed);

		const defaulted = buildEvaluationContext({ mode: 'local-debug' });
		const delta = Math.abs(defaulted.now.getTime() - Date.now());
		expect(delta).toBeLessThan(5_000);
	});
});

describe('runtime/evaluation-context AsyncLocalStorage integration', () => {
	it('getEvaluationContext returns undefined outside runWithRequestContext', () => {
		expect(getEvaluationContext()).toBeUndefined();
	});

	it('setEvaluationContext is a no-op outside runWithRequestContext (no throw)', () => {
		expect(() => setEvaluationContext(buildEvaluationContext({ mode: 'demo' }))).not.toThrow();
		// 外側には残らない
		expect(getEvaluationContext()).toBeUndefined();
	});

	it('set then get within runWithRequestContext round-trips', async () => {
		const ctx: EvaluationContext = buildEvaluationContext({
			mode: 'nuc-prod',
			user: { id: 'u-1', role: 'owner', groups: [] },
			plan: { tier: 'family', status: 'active', trialState: 'none' },
			licenseKey: { valid: true, expiresAt: new Date('2030-12-31Z') },
			now: new Date('2026-04-19T00:00:00Z'),
		});

		await runWithRequestContext(async () => {
			setEvaluationContext(ctx);
			expect(getEvaluationContext()).toBe(ctx);
		});

		// ストア外に抜けたら undefined
		expect(getEvaluationContext()).toBeUndefined();
	});

	it('two nested runWithRequestContext share the outer store (set visible inside)', async () => {
		const outer = buildEvaluationContext({ mode: 'aws-prod' });
		const inner = buildEvaluationContext({ mode: 'demo' });

		await runWithRequestContext(async () => {
			setEvaluationContext(outer);
			await runWithRequestContext(async () => {
				// request-context.ts の仕様: ネスト時は既存を再利用
				expect(getEvaluationContext()).toBe(outer);
				// 内側で上書きすると外側にも反映される（同一ストア）
				setEvaluationContext(inner);
				expect(getEvaluationContext()).toBe(inner);
			});
			expect(getEvaluationContext()).toBe(inner);
		});
	});

	it('separate runWithRequestContext calls do not leak contexts to each other', async () => {
		const a = buildEvaluationContext({ mode: 'aws-prod' });
		const b = buildEvaluationContext({ mode: 'nuc-prod' });

		await runWithRequestContext(async () => {
			setEvaluationContext(a);
			expect(getEvaluationContext()?.mode).toBe('aws-prod');
		});

		await runWithRequestContext(async () => {
			expect(getEvaluationContext()).toBeUndefined();
			setEvaluationContext(b);
			expect(getEvaluationContext()?.mode).toBe('nuc-prod');
		});
	});
});
