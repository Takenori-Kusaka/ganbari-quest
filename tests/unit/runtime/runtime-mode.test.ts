import { describe, expect, it } from 'vitest';

import type { TypedEnv } from '$lib/runtime/env';
import {
	RUNTIME_MODE_PROFILES,
	RUNTIME_MODES,
	type RuntimeMode,
	resolveRuntimeMode,
} from '$lib/runtime/runtime-mode';

type ModeEnv = Pick<
	TypedEnv,
	'APP_MODE' | 'IS_NUC_DEPLOY' | 'AWS_LAMBDA_FUNCTION_NAME' | 'NODE_ENV'
>;

const baseEnv: ModeEnv = {
	APP_MODE: undefined,
	IS_NUC_DEPLOY: undefined,
	AWS_LAMBDA_FUNCTION_NAME: undefined,
	NODE_ENV: 'development',
};

describe('runtime/runtime-mode resolveRuntimeMode (ADR-0040 P2)', () => {
	it('returns local-debug when nothing is set', () => {
		expect(resolveRuntimeMode({ env: baseEnv })).toBe('local-debug');
	});

	it('returns build when isBuilding=true and APP_MODE is unset', () => {
		expect(resolveRuntimeMode({ env: baseEnv, isBuilding: true })).toBe('build');
	});

	it('returns demo when isDemoRequest=true (primary signal, ADR-0039/#1199)', () => {
		expect(resolveRuntimeMode({ env: baseEnv, isDemoRequest: true })).toBe('demo');
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/', isDemoRequest: true })).toBe('demo');
	});

	it('returns local-debug when isDemoRequest=false even if pathname is /demo', () => {
		// 明示的に isDemoRequest=false を渡した場合は pathname フォールバックも抑止される
		expect(
			resolveRuntimeMode({ env: baseEnv, pathname: '/demo', isDemoRequest: false }),
		).toBe('local-debug');
	});

	it('returns demo via pathname fallback when isDemoRequest is undefined', () => {
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/demo' })).toBe('demo');
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/demo/upper' })).toBe('demo');
	});

	it('returns local-debug for non-demo pathnames', () => {
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/' })).toBe('local-debug');
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/admin' })).toBe('local-debug');
		expect(resolveRuntimeMode({ env: baseEnv, pathname: '/demonstrate' })).toBe('local-debug');
	});

	it('returns nuc-prod when IS_NUC_DEPLOY is true', () => {
		expect(resolveRuntimeMode({ env: { ...baseEnv, IS_NUC_DEPLOY: true } })).toBe('nuc-prod');
	});

	it('returns aws-prod when AWS_LAMBDA_FUNCTION_NAME is set', () => {
		expect(
			resolveRuntimeMode({
				env: { ...baseEnv, AWS_LAMBDA_FUNCTION_NAME: 'ganbari-quest-prod' },
			}),
		).toBe('aws-prod');
	});

	it('treats empty AWS_LAMBDA_FUNCTION_NAME as not set', () => {
		expect(resolveRuntimeMode({ env: { ...baseEnv, AWS_LAMBDA_FUNCTION_NAME: '' } })).toBe(
			'local-debug',
		);
	});

	it('prefers explicit APP_MODE over all other signals', () => {
		// APP_MODE が他の全条件より強いことを確認
		for (const mode of RUNTIME_MODES) {
			expect(
				resolveRuntimeMode({
					env: {
						APP_MODE: mode,
						IS_NUC_DEPLOY: true,
						AWS_LAMBDA_FUNCTION_NAME: 'lambda',
						NODE_ENV: 'production',
					},
					pathname: '/demo',
					isBuilding: true,
				}),
			).toBe(mode);
		}
	});

	it('prefers demo over nuc-prod when both would apply', () => {
		// nuc-prod サーバー上でも /demo は demo として扱う
		expect(
			resolveRuntimeMode({
				env: { ...baseEnv, IS_NUC_DEPLOY: true },
				pathname: '/demo/upper',
			}),
		).toBe('demo');
	});

	it('prefers demo over aws-prod when both would apply', () => {
		expect(
			resolveRuntimeMode({
				env: { ...baseEnv, AWS_LAMBDA_FUNCTION_NAME: 'ganbari-quest-prod' },
				pathname: '/demo',
			}),
		).toBe('demo');
	});

	it('prefers build over demo / nuc / aws', () => {
		// ビルド中は「リクエスト」という概念がないが、prerender で pathname が
		// 渡されうる。build が最強（APP_MODE 未指定時）。
		expect(
			resolveRuntimeMode({
				env: { ...baseEnv, IS_NUC_DEPLOY: true, AWS_LAMBDA_FUNCTION_NAME: 'lambda' },
				pathname: '/demo',
				isBuilding: true,
			}),
		).toBe('build');
	});

	it('prefers nuc-prod over aws-prod when both are set (should not happen in practice)', () => {
		// 物理的には共存しないが、設定ミス耐性として IS_NUC_DEPLOY を優先する
		expect(
			resolveRuntimeMode({
				env: {
					...baseEnv,
					IS_NUC_DEPLOY: true,
					AWS_LAMBDA_FUNCTION_NAME: 'should-be-ignored',
				},
			}),
		).toBe('nuc-prod');
	});

	it('returns the same mode regardless of NODE_ENV', () => {
		// NODE_ENV は mode 判定に直接は影響しない（env override や debug 用途のため）
		const prodEnv: ModeEnv = { ...baseEnv, NODE_ENV: 'production' };
		expect(resolveRuntimeMode({ env: prodEnv })).toBe('local-debug');
	});
});

describe('runtime/runtime-mode RUNTIME_MODES list integrity', () => {
	it('exports exactly 5 modes', () => {
		expect(RUNTIME_MODES).toHaveLength(5);
	});

	it('includes all known modes', () => {
		const expected: RuntimeMode[] = ['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod'];
		for (const mode of expected) {
			expect(RUNTIME_MODES).toContain(mode);
		}
	});

	it('has a profile for every mode', () => {
		for (const mode of RUNTIME_MODES) {
			expect(RUNTIME_MODE_PROFILES[mode]).toBeDefined();
		}
	});
});

describe('runtime/runtime-mode RUNTIME_MODE_PROFILES sanity', () => {
	it('build and demo do not accept writes', () => {
		expect(RUNTIME_MODE_PROFILES.build.acceptsWrites).toBe(false);
		expect(RUNTIME_MODE_PROFILES.demo.acceptsWrites).toBe(false);
	});

	it('local-debug uses local-sqlite + local auth', () => {
		expect(RUNTIME_MODE_PROFILES['local-debug']).toMatchObject({
			persistence: 'local-sqlite',
			authMode: 'local',
			acceptsWrites: true,
		});
	});

	it('aws-prod uses dynamodb + cognito', () => {
		expect(RUNTIME_MODE_PROFILES['aws-prod']).toMatchObject({
			persistence: 'dynamodb',
			authMode: 'cognito',
			acceptsWrites: true,
		});
	});

	it('nuc-prod uses local-sqlite + cognito', () => {
		expect(RUNTIME_MODE_PROFILES['nuc-prod']).toMatchObject({
			persistence: 'local-sqlite',
			authMode: 'cognito',
			acceptsWrites: true,
		});
	});
});
