/**
 * tests/unit/scripts/claude-hook-prevent-qa-account-pr.test.ts (#1994 AC3)
 *
 * scripts/claude-hook-prevent-qa-account-pr.mjs の純粋関数を unit test する。
 *
 * #1994 で hook の検出範囲を拡張 (gh pr create に加えて gh api repos/.../pulls も捕捉) した
 * 際の回帰防止と、parseActiveAccount の正規表現ロジック検証が目的。
 *
 * 関連:
 *   - Issue #1994 (本テスト導入 Issue) / Issue #1879 (元 hook 導入)
 *   - ADR-0022 amendment 3
 */

import { describe, expect, it } from 'vitest';

import {
	ALLOWED_PR_AUTHOR_DEFAULT,
	containsGhPrCreate,
	parseActiveAccount,
	QA_ACCOUNT,
} from '../../../scripts/claude-hook-prevent-qa-account-pr.mjs';

describe('containsGhPrCreate', () => {
	it('gh pr create を含む command → true', () => {
		expect(containsGhPrCreate('gh pr create --draft --title "x"')).toBe(true);
	});

	it('複数空白でも検出する', () => {
		expect(containsGhPrCreate('gh   pr   create')).toBe(true);
	});

	it('gh pr view (read-only) → false (誤検知しない)', () => {
		expect(containsGhPrCreate('gh pr view 1234')).toBe(false);
	});

	it('gh issue create (PR でない) → false', () => {
		expect(containsGhPrCreate('gh issue create --title "x"')).toBe(false);
	});

	it('gh api repos/owner/repo/pulls (REST 直叩きで PR 作成) → true (#1994 拡張)', () => {
		expect(
			containsGhPrCreate(
				'gh api repos/Takenori-Kusaka/ganbari-quest/pulls --method POST --field title=x',
			),
		).toBe(true);
	});

	it('gh api repos/.../pulls/123/comments (subresource、過剰停止許容) → true', () => {
		// false-positive を許容する設計判断。誤検知のコスト < 違反 PR 起票による品質ゲート崩壊コスト。
		// 本テストは設計判断を明示的に固定する (将来の作為的緩和を防ぐ)。
		expect(
			containsGhPrCreate('gh api repos/Takenori-Kusaka/ganbari-quest/pulls/123/comments'),
		).toBe(true);
	});

	it('gh api user (PR 無関係) → false', () => {
		expect(containsGhPrCreate('gh api user')).toBe(false);
	});

	it('文字列でない (undefined / null / number) → false', () => {
		expect(containsGhPrCreate(undefined)).toBe(false);
		expect(containsGhPrCreate(null)).toBe(false);
		expect(containsGhPrCreate(42)).toBe(false);
	});

	it('空文字列 → false', () => {
		expect(containsGhPrCreate('')).toBe(false);
	});
});

describe('parseActiveAccount', () => {
	it('Takenori-Kusaka が active → "Takenori-Kusaka"', () => {
		const output = [
			'github.com',
			'  ✓ Logged in to github.com account Takenori-Kusaka (keyring)',
			'  - Active account: true',
		].join('\n');
		expect(parseActiveAccount(output)).toBe('Takenori-Kusaka');
	});

	it('ganbariquestsupport-lab が active → "ganbariquestsupport-lab"', () => {
		const output = [
			'github.com',
			'  ✓ Logged in to github.com account Takenori-Kusaka (keyring)',
			'  - Active account: false',
			'  ✓ Logged in to github.com account ganbariquestsupport-lab (keyring)',
			'  - Active account: true',
		].join('\n');
		expect(parseActiveAccount(output)).toBe('ganbariquestsupport-lab');
	});

	it('空文字列 / null / undefined → null', () => {
		expect(parseActiveAccount('')).toBeNull();
		expect(parseActiveAccount(null as unknown as string)).toBeNull();
		expect(parseActiveAccount(undefined as unknown as string)).toBeNull();
	});

	it('Active account 行のみ (Login 行なし、不正形式) → null', () => {
		expect(parseActiveAccount('  - Active account: true')).toBeNull();
	});
});

describe('定数', () => {
	it('ALLOWED_PR_AUTHOR_DEFAULT === Takenori-Kusaka', () => {
		expect(ALLOWED_PR_AUTHOR_DEFAULT).toBe('Takenori-Kusaka');
	});

	it('QA_ACCOUNT === ganbariquestsupport-lab', () => {
		expect(QA_ACCOUNT).toBe('ganbariquestsupport-lab');
	});
});
