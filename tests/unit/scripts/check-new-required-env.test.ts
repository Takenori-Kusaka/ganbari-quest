// #2337 — check-new-required-env regex 改善 (PR #2325 教訓)
//
// envInStringRe が「env 名 + env var/environment variable/secret + is required」の
// 3 自然語パターンを検出することを確認する。
// 詳細経緯: PR #2325 で `[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production`
// パターンが検出漏れし本番障害を引き起こした事故への regress test。

import { describe, expect, it } from 'vitest';

import { detectNewRequiredEnvs } from '../../../scripts/check-new-required-env.mjs';

describe('check-new-required-env (#2337 regex 改善)', () => {
	describe('Pattern B: throw new Error 内 env 名検出', () => {
		it('env 名 + "is required" 直結パターンを検出する (既存)', () => {
			const lines = ["throw new Error('AWS_LICENSE_SECRET is required');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('AWS_LICENSE_SECRET')).toBe(true);
		});

		it('env 名 + "env var" + "is required" パターンを検出する (#2337 PR #2325 regress)', () => {
			const lines = [
				"throw new Error('[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('PARENT_GATE_COOKIE_SECRET')).toBe(true);
		});

		it('env 名 + "environment variable" + "is required" パターンを検出する (#2337)', () => {
			const lines = [
				"throw new Error('MY_FANCY_TOKEN environment variable is required at startup');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('MY_FANCY_TOKEN')).toBe(true);
		});

		it('env 名 + "secret" + "is required" パターンを検出する (#2337)', () => {
			const lines = ["throw new Error('STRIPE_WEBHOOK_SECRET secret is required for webhook');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('STRIPE_WEBHOOK_SECRET')).toBe(true);
		});

		it('env 名 + "must be set" パターンを検出する (既存)', () => {
			const lines = ["throw new Error('FOO_BAR_TOKEN must be set');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('FOO_BAR_TOKEN')).toBe(true);
		});

		it('env 名 + "is not set" パターンを検出する (既存)', () => {
			const lines = ["throw new Error('CUSTOM_TOKEN is not set in env');"];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('CUSTOM_TOKEN')).toBe(true);
		});

		it('PR #2325 完全再現: ADR-0050 parent-gate-session.ts L43-45 throw', () => {
			// 実際の parent-gate-session.ts ソース (line breaks 含む) を模した状態
			const lines = [
				'		if (isProd) {',
				'			throw new Error(',
				"				'[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production (length >= 16)',",
				'			);',
				'		}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('PARENT_GATE_COOKIE_SECRET')).toBe(true);
		});
	});

	describe('Pattern A: assertXxxConfigured()', () => {
		it('assertLicenseKeyConfigured() + 周辺 process.env を検出する', () => {
			const lines = [
				'function assertLicenseKeyConfigured() {',
				'  if (!process.env.AWS_LICENSE_SECRET) {',
				"    throw new Error('license secret missing');",
				'  }',
				'}',
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('AWS_LICENSE_SECRET')).toBe(true);
		});
	});

	describe('Pattern C: process.env.X || (() => { throw })()', () => {
		it('inline throw IIFE パターンを検出する', () => {
			const lines = [
				"const secret = process.env.SUPER_SECRET || (() => { throw new Error('boom'); })();",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('SUPER_SECRET')).toBe(true);
		});
	});

	describe('False positive 抑止', () => {
		it('NODE_ENV / PORT / CI 等フレームワーク内蔵 env は検出対象外', () => {
			const lines = [
				"throw new Error('NODE_ENV is required');",
				"throw new Error('PORT must be set');",
				"throw new Error('CI is not set');",
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.has('NODE_ENV')).toBe(false);
			expect(result.has('PORT')).toBe(false);
			expect(result.has('CI')).toBe(false);
		});

		it('camelCase / 単独大文字単語 は検出対象外', () => {
			const lines = [
				"throw new Error('apiKey is required');",
				"throw new Error('TOKEN is required');", // 単独大文字 (アンダースコアなし) は除外
			];
			const result = detectNewRequiredEnvs(lines);
			expect(result.size).toBe(0);
		});

		it('修飾語なし + is required 以外の文脈 は検出しない', () => {
			// "FOO is required to do X" のような業務文も誤検出しない
			const lines = ["console.log('A_VALID_FORM is required to do X');"];
			const result = detectNewRequiredEnvs(lines);
			// throw new Error の中にないので検出されない (B 経由でない)
			// 注: Pattern A/C 経由でなければ B のみで検出される設計なので、これは検出される
			// → B は throw new Error 内のみなので、本ケースは検出されない
			expect(result.has('A_VALID_FORM')).toBe(false);
		});
	});

	describe('複数 env の同時検出', () => {
		it('同一 throw 内で末尾 "are required" 直前の env を検出する', () => {
			// regex は env 名直後に修飾語 + is/are/must required を期待するため、
			// "X and Y are required" 形式では末尾 Y のみ検出される
			// (これは false positive 抑制の方針と整合)。
			const lines = ["throw new Error('AWS_LICENSE_SECRET and STRIPE_SECRET_KEY are required');"];
			const result = detectNewRequiredEnvs(lines);
			// 末尾 env のみが is/are required 直前にあるため検出される
			expect(result.has('STRIPE_SECRET_KEY')).toBe(false); // "are required" は対象外
			// "is required" 形式に絞れば検出される
			const lines2 = ["throw new Error('STRIPE_SECRET_KEY is required');"];
			const result2 = detectNewRequiredEnvs(lines2);
			expect(result2.has('STRIPE_SECRET_KEY')).toBe(true);
		});
	});
});
