import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getEnv, resetEnvForTesting } from '$lib/runtime/env';

describe('runtime/env Typed Config Object (ADR-0040 P1)', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		resetEnvForTesting();
		// Start from a clean slate — each test sets only what it needs.
		for (const k of Object.keys(process.env)) {
			delete process.env[k];
		}
	});

	afterEach(() => {
		resetEnvForTesting();
		for (const k of Object.keys(process.env)) {
			delete process.env[k];
		}
		for (const [k, v] of Object.entries(originalEnv)) {
			if (v !== undefined) process.env[k] = v;
		}
	});

	it('parses empty env with defaults applied', () => {
		const env = getEnv();
		expect(env.NODE_ENV).toBe('development');
		expect(env.AUTH_MODE).toBe('local');
		expect(env.AWS_REGION).toBe('us-east-1');
		expect(env.DATABASE_URL).toBe('./data/ganbari-quest.db');
		expect(env.DATA_SOURCE).toBe('sqlite');
		expect(env.OPS_DOMAIN_COST_JPY).toBe(117);
		expect(env.VAPID_SUBJECT).toBe('mailto:noreply@ganbari-quest.com');
		expect(env.GEMINI_MODEL).toBe('gemini-2.0-flash');
	});

	it('coerces boolean string envs', () => {
		process.env.MAINTENANCE_MODE = 'true';
		process.env.STRIPE_MOCK = 'false';
		process.env.IS_NUC_DEPLOY = 'true';
		const env = getEnv();
		expect(env.MAINTENANCE_MODE).toBe(true);
		expect(env.STRIPE_MOCK).toBe(false);
		expect(env.IS_NUC_DEPLOY).toBe(true);
	});

	it('coerces numeric envs', () => {
		process.env.OPS_DOMAIN_COST_JPY = '250';
		process.env.OPS_VIRTUAL_OFFICE_COST_JPY = '1500';
		const env = getEnv();
		expect(env.OPS_DOMAIN_COST_JPY).toBe(250);
		expect(env.OPS_VIRTUAL_OFFICE_COST_JPY).toBe(1500);
	});

	it('accepts all valid APP_MODE values (ADR-0040)', () => {
		const modes = ['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod'] as const;
		for (const mode of modes) {
			resetEnvForTesting();
			process.env.APP_MODE = mode;
			const env = getEnv();
			expect(env.APP_MODE).toBe(mode);
		}
	});

	it('rejects invalid APP_MODE', () => {
		process.env.APP_MODE = 'bogus';
		expect(() => getEnv()).toThrow(/APP_MODE/);
	});

	it('rejects invalid boolean string', () => {
		process.env.MAINTENANCE_MODE = 'yes';
		expect(() => getEnv()).toThrow(/MAINTENANCE_MODE/);
	});

	it('accepts DEBUG_PLAN variants (#758)', () => {
		for (const plan of ['free', 'standard', 'family']) {
			resetEnvForTesting();
			process.env.DEBUG_PLAN = plan;
			const env = getEnv();
			expect(env.DEBUG_PLAN).toBe(plan);
		}
	});

	it('rejects AWS_LICENSE_SECRET shorter than 32 chars (ADR-0026)', () => {
		process.env.AWS_LICENSE_SECRET = 'too-short';
		expect(() => getEnv()).toThrow(/AWS_LICENSE_SECRET/);
	});

	it('accepts AWS_LICENSE_SECRET at exactly 32 chars', () => {
		process.env.AWS_LICENSE_SECRET = 'a'.repeat(32);
		const env = getEnv();
		expect(env.AWS_LICENSE_SECRET).toBe('a'.repeat(32));
	});

	it('rejects CRON_SECRET shorter than 32 chars', () => {
		process.env.CRON_SECRET = 'short';
		expect(() => getEnv()).toThrow(/CRON_SECRET/);
	});

	it('caches parse result across calls', () => {
		const first = getEnv();
		const second = getEnv();
		expect(second).toBe(first);
	});

	it('resetEnvForTesting() forces re-parse', () => {
		process.env.AUTH_MODE = 'local';
		const first = getEnv();
		expect(first.AUTH_MODE).toBe('local');

		resetEnvForTesting();
		process.env.AUTH_MODE = 'cognito';
		const second = getEnv();
		expect(second.AUTH_MODE).toBe('cognito');
	});

	it('includes all violating fields in thrown error', () => {
		process.env.APP_MODE = 'bad';
		process.env.MAINTENANCE_MODE = 'nope';
		try {
			getEnv();
			throw new Error('expected throw');
		} catch (e) {
			const msg = (e as Error).message;
			expect(msg).toContain('APP_MODE');
			expect(msg).toContain('MAINTENANCE_MODE');
		}
	});
});
