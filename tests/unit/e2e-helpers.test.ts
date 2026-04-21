// tests/unit/e2e-helpers.test.ts
// #1386: isAwsEnv の URL 判定が new URL() + hostname 比較になっており、
// includes() 時代の suffix / path 攻撃を受けないことを検証する。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isAwsEnv, isLocalEnv } from '../e2e/helpers';

describe('isAwsEnv (#1386)', () => {
	const original = process.env.E2E_BASE_URL;

	beforeEach(() => {
		process.env.E2E_BASE_URL = '';
	});
	afterEach(() => {
		process.env.E2E_BASE_URL = original;
	});

	it.each([
		['https://ganbari-quest.com/', true],
		['https://www.ganbari-quest.com/', true],
		['https://api.ganbari-quest.com/', true],
		['https://dxxxxx.cloudfront.amazonaws.com/', true],
		['https://abcdef.execute-api.ap-northeast-1.amazonaws.com/', true],
		['http://localhost:5173/', false],
		['http://127.0.0.1:5173/', false],
		// suffix 攻撃: ホスト末尾が別ドメイン
		['https://ganbari-quest.com.attacker.com/', false],
		['https://amazonaws.com.attacker.com/', false],
		// path に含まれているだけ
		['https://evil.com/ganbari-quest.com/', false],
		['https://evil.com/amazonaws.com', false],
		// 類似名での誤判定
		['https://my-ganbari-quest.comedy.com/', false],
		// 空文字 / 不正 URL
		['', false],
		['not a url', false],
	])('E2E_BASE_URL=%s → %s', (url, expected) => {
		process.env.E2E_BASE_URL = url;
		expect(isAwsEnv()).toBe(expected);
	});

	it('isLocalEnv は isAwsEnv の反転', () => {
		process.env.E2E_BASE_URL = 'https://ganbari-quest.com/';
		expect(isLocalEnv()).toBe(false);
		process.env.E2E_BASE_URL = 'http://localhost:5173/';
		expect(isLocalEnv()).toBe(true);
	});
});
