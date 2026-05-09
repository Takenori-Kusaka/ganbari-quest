/**
 * tests/unit/scripts/check-gh-account-before-pr.test.ts (#1994 AC3)
 *
 * scripts/check-gh-account-before-pr.mjs の純粋関数を unit test する。
 *
 * 既存 hook (#1879) が PR #1875 / #1982 で 2 回連続違反を防げなかった構造的原因の 1 つは、
 * `extractActiveAccount` の出力解釈ロジック / `evaluateActiveAccount` の判定ロジックを
 * 一切テストしておらず、回帰時の挙動が保証されていなかったため。
 *
 * 本テストは以下を検証する:
 *   - extractActiveAccount: gh auth status の典型出力で active アカウントを正しく抽出
 *   - evaluateActiveAccount: 許可 / 不許可 / null / QA アカウント の 4 象限を網羅
 *
 * 関連:
 *   - Issue #1994 (本テスト導入 Issue)
 *   - ADR-0022 amendment 1 / 3
 */

import { describe, expect, it } from 'vitest';

import {
	ALLOWED_PR_AUTHOR_DEFAULT,
	evaluateActiveAccount,
	extractActiveAccount,
	QA_ACCOUNT,
} from '../../../scripts/check-gh-account-before-pr.mjs';

describe('extractActiveAccount', () => {
	it('Takenori-Kusaka が active なら "Takenori-Kusaka" を返す', () => {
		const output = [
			'github.com',
			'  ✓ Logged in to github.com account Takenori-Kusaka (keyring)',
			'  - Active account: true',
			'  ✓ Logged in to github.com account ganbariquestsupport-lab (keyring)',
			'  - Active account: false',
		].join('\n');
		expect(extractActiveAccount(output)).toBe('Takenori-Kusaka');
	});

	it('ganbariquestsupport-lab が active なら "ganbariquestsupport-lab" を返す', () => {
		const output = [
			'github.com',
			'  ✓ Logged in to github.com account Takenori-Kusaka (keyring)',
			'  - Active account: false',
			'  ✓ Logged in to github.com account ganbariquestsupport-lab (keyring)',
			'  - Active account: true',
		].join('\n');
		expect(extractActiveAccount(output)).toBe('ganbariquestsupport-lab');
	});

	it('Active account 行が無い (旧 gh CLI 等) → null', () => {
		const output = ['github.com', '  ✓ Logged in to github.com account Takenori-Kusaka'].join('\n');
		expect(extractActiveAccount(output)).toBeNull();
	});

	it('空文字列 → null', () => {
		expect(extractActiveAccount('')).toBeNull();
	});

	it('CRLF 改行 (Windows) でも抽出できる', () => {
		const output = [
			'github.com',
			'  ✓ Logged in to github.com account Takenori-Kusaka (keyring)',
			'  - Active account: true',
		].join('\r\n');
		expect(extractActiveAccount(output)).toBe('Takenori-Kusaka');
	});
});

describe('evaluateActiveAccount', () => {
	it('Takenori-Kusaka が active → ok=true', () => {
		const verdict = evaluateActiveAccount('Takenori-Kusaka');
		expect(verdict.ok).toBe(true);
		expect(verdict.isQa).toBe(false);
		expect(verdict.reason).toBeNull();
	});

	it('ganbariquestsupport-lab が active → ok=false, isQa=true', () => {
		const verdict = evaluateActiveAccount(QA_ACCOUNT);
		expect(verdict.ok).toBe(false);
		expect(verdict.isQa).toBe(true);
		expect(verdict.reason).toContain(QA_ACCOUNT);
		expect(verdict.reason).toContain(ALLOWED_PR_AUTHOR_DEFAULT);
	});

	it('未知のアカウント (some-bot) → ok=false, isQa=false', () => {
		const verdict = evaluateActiveAccount('some-bot');
		expect(verdict.ok).toBe(false);
		expect(verdict.isQa).toBe(false);
		expect(verdict.reason).toContain('some-bot');
	});

	it('null (active 不明) → ok=false', () => {
		const verdict = evaluateActiveAccount(null);
		expect(verdict.ok).toBe(false);
		expect(verdict.reason).toContain('active アカウントを判定できませんでした');
	});

	it('opts.allowed で許可リスト上書き可能 (将来 contributor 拡張用)', () => {
		const verdict = evaluateActiveAccount('alice', { allowed: 'alice' });
		expect(verdict.ok).toBe(true);
	});

	it('default の許可リストは Takenori-Kusaka', () => {
		expect(ALLOWED_PR_AUTHOR_DEFAULT).toBe('Takenori-Kusaka');
	});

	it('QA_ACCOUNT 定数が ganbariquestsupport-lab', () => {
		// ADR-0022 で機械強制している契約値。ここを誤って書き換えると
		// hook / workflow / docs が一斉に乖離するため、定数として明示テストする。
		expect(QA_ACCOUNT).toBe('ganbariquestsupport-lab');
	});
});
