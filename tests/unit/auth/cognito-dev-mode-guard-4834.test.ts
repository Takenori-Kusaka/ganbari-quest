// tests/unit/auth/cognito-dev-mode-guard-4834.test.ts
//
// isCognitoDevMode() は顧客が触る deploy (aws-prod / nuc-prod) では COGNITO_DEV_MODE=true が
// env に紛れ込んでも false を返す (fail-closed)。dev mode は固定パスワードで誰でも入れ、
// /auth/login が資格情報を HTML に出すため、「本番には設定されていない」ことだけに頼らない。
// 一方 vite preview (e2e-cognito-dev lane) は NODE_ENV=production + COGNITO_DEV_MODE=true を
// 正当に使うので、NODE_ENV では遮断しない。
import { afterEach, describe, expect, it, vi } from 'vitest';

const envState: Record<string, unknown> = {};
vi.mock('$lib/runtime/env', () => ({
	getEnv: () => envState,
}));
const mockWarn = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function setEnv(overrides: Record<string, unknown>) {
	for (const k of Object.keys(envState)) delete envState[k];
	Object.assign(envState, { NODE_ENV: 'development', AUTH_MODE: 'cognito' }, overrides);
}

const { isCognitoDevMode, cognitoDevModeDenialReason } = await import(
	'../../../src/lib/server/auth/auth-mode'
);

describe('isCognitoDevMode の deploy guard (#4834)', () => {
	afterEach(() => setEnv({}));

	it('COGNITO_DEV_MODE 未設定 / false なら false', () => {
		setEnv({});
		expect(isCognitoDevMode()).toBe(false);
		setEnv({ COGNITO_DEV_MODE: false });
		expect(isCognitoDevMode()).toBe(false);
	});

	it('ローカル (local-debug) では true', () => {
		setEnv({ COGNITO_DEV_MODE: true });
		expect(isCognitoDevMode()).toBe(true);
	});

	it('vite preview (NODE_ENV=production、Lambda / NUC ではない) では true のまま — e2e-cognito-dev lane を壊さない', () => {
		setEnv({ COGNITO_DEV_MODE: true, NODE_ENV: 'production' });
		expect(isCognitoDevMode()).toBe(true);
	});

	it('Lambda (AWS_LAMBDA_FUNCTION_NAME) では COGNITO_DEV_MODE=true でも false', () => {
		setEnv({ COGNITO_DEV_MODE: true, NODE_ENV: 'production', AWS_LAMBDA_FUNCTION_NAME: 'gq-app' });
		expect(isCognitoDevMode()).toBe(false);
	});

	it('NUC (IS_NUC_DEPLOY) では COGNITO_DEV_MODE=true でも false', () => {
		setEnv({ COGNITO_DEV_MODE: true, IS_NUC_DEPLOY: true });
		expect(isCognitoDevMode()).toBe(false);
	});

	it('APP_MODE で aws-prod / nuc-prod を明示した場合も false', () => {
		setEnv({ COGNITO_DEV_MODE: true, APP_MODE: 'aws-prod' });
		expect(isCognitoDevMode()).toBe(false);
		setEnv({ COGNITO_DEV_MODE: true, APP_MODE: 'nuc-prod' });
		expect(isCognitoDevMode()).toBe(false);
	});

	it('Lambda 上で APP_MODE=local-debug が紛れても false (resolveRuntimeMode の APP_MODE override より生の Lambda signal が優先)', () => {
		setEnv({ COGNITO_DEV_MODE: true, APP_MODE: 'local-debug', AWS_LAMBDA_FUNCTION_NAME: 'gq-app' });
		expect(isCognitoDevMode()).toBe(false);
		expect(cognitoDevModeDenialReason(envState as never)).toContain('AWS_LAMBDA_FUNCTION_NAME');
	});

	it('拒否したときは理由付きで warn を出す (dev:cognito で案内が消えた原因を log で追える)', () => {
		setEnv({ COGNITO_DEV_MODE: true, IS_NUC_DEPLOY: true });
		expect(isCognitoDevMode()).toBe(false);
		// warn はプロセスで 1 回だけ (前の case が先に拒否していれば、その理由が残る)
		expect(mockWarn).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(mockWarn.mock.calls)).toMatch(/AWS_LAMBDA_FUNCTION_NAME|IS_NUC_DEPLOY/);
	});
});
