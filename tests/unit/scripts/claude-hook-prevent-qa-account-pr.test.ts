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
 *   - Issue #3999 AC3 (判定 SSOT の import 解決失敗を fail-closed 化)
 *   - ADR-0022 amendment 3
 */

import { describe, expect, it } from 'vitest';

import {
	ALLOWED_PR_AUTHOR_DEFAULT,
	containsGhPrCreate,
	parseActiveAccount,
	QA_ACCOUNT,
} from '../../../scripts/claude-hook-prevent-qa-account-pr.mjs';
import {
	bashPayload,
	IS_MAIN_WITHOUT_EXPORT,
	runHookInIsolatedTree,
} from '../helpers/hook-tree-probe';

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

	it('gh api repos/.../pulls/123/comments (subresource) → false (#4027)', () => {
		// 旧実装は `/pulls` 部分一致で subresource まで PR 作成扱いにしていた。
		// #4027 で「コレクションへの POST だけを PR 作成とみなす」に是正。
		expect(
			containsGhPrCreate('gh api repos/Takenori-Kusaka/ganbari-quest/pulls/123/comments'),
		).toBe(false);
	});

	it('gh api repos/.../pulls/<n>/reviews -X POST (QM approve 経路) → false (#4027)', () => {
		expect(
			containsGhPrCreate(
				'gh api repos/Takenori-Kusaka/ganbari-quest/pulls/4005/reviews -X POST -f event=APPROVE',
			),
		).toBe(false);
	});

	it('gh api repos/.../pulls (GET 一覧) → false (#4027、作成ではない)', () => {
		expect(containsGhPrCreate('gh api repos/Takenori-Kusaka/ganbari-quest/pulls')).toBe(false);
	});

	it('gh api repos/.../pulls -X POST は引き続き BLOCK (ADR-0022 / 弱体化させない)', () => {
		expect(containsGhPrCreate('gh api repos/Takenori-Kusaka/ganbari-quest/pulls -X POST')).toBe(
			true,
		);
	});

	it('flag 先行 / path 後置の順序でも BLOCK', () => {
		expect(
			containsGhPrCreate('gh api -X POST -f title=x repos/Takenori-Kusaka/ganbari-quest/pulls'),
		).toBe(true);
	});

	it('末尾スラッシュ付きコレクション POST も BLOCK', () => {
		expect(
			containsGhPrCreate('gh api repos/Takenori-Kusaka/ganbari-quest/pulls/ --method POST'),
		).toBe(true);
	});

	it('絶対 URL 形式のコレクション POST も BLOCK', () => {
		expect(
			containsGhPrCreate(
				'gh api https://api.github.com/repos/Takenori-Kusaka/ganbari-quest/pulls --method post -f head=a -f base=b',
			),
		).toBe(true);
	});

	it('query で subresource に見せかけたコレクション POST も BLOCK (偽装耐性)', () => {
		expect(
			containsGhPrCreate(
				'gh api "repos/Takenori-Kusaka/ganbari-quest/pulls?ref=/pulls/1/reviews" -X POST -f head=a',
			),
		).toBe(true);
	});

	it('引数値に subresource path を書いてもコレクション POST なら BLOCK (偽装耐性)', () => {
		expect(
			containsGhPrCreate(
				'gh api repos/Takenori-Kusaka/ganbari-quest/pulls -X POST -f title=/pulls/1/reviews -f head=a',
			),
		).toBe(true);
	});

	it('subresource POST と作成 POST を連結しても作成側を BLOCK', () => {
		expect(
			containsGhPrCreate(
				'gh api repos/o/r/pulls/1/reviews -X POST -f event=APPROVE && gh api repos/o/r/pulls -X POST -f head=a',
			),
		).toBe(true);
	});

	it('-f だけ (method 省略) のコレクション呼び出しも POST とみなし BLOCK', () => {
		expect(containsGhPrCreate('gh api repos/o/r/pulls -f title=x -f head=a -f base=main')).toBe(
			true,
		);
	});

	it('別 shell で包んだ作成コマンドも BLOCK (引用符で隠せない)', () => {
		expect(containsGhPrCreate('bash -c "gh api repos/o/r/pulls -X POST -f head=a"')).toBe(true);
	});

	it("PowerShell 経路 (& 'gh' / gh.exe) の作成コマンドも BLOCK", () => {
		expect(containsGhPrCreate("& 'gh.exe' pr create --draft --title x")).toBe(true);
		expect(containsGhPrCreate("& 'gh' api repos/o/r/pulls -X POST -f head=a")).toBe(true);
	});

	it('graphql createPullRequest mutation も BLOCK', () => {
		expect(
			containsGhPrCreate(
				"gh api graphql -f query='mutation { createPullRequest(input: {}) { pullRequest { id } } }'",
			),
		).toBe(true);
	});

	it('--body / heredoc の中身に作成コマンド例があっても捕捉しない (#4027 対応 3)', () => {
		const command = [
			"gh issue create --title 'hook の説明' --body \"$(cat <<'EOF'",
			'再現コマンド: gh api repos/o/r/pulls -X POST -f head=a',
			'あわせて gh pr create --draft も試した',
			'EOF',
			')"',
		].join('\n');
		expect(containsGhPrCreate(command)).toBe(false);
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

/**
 * 判定 SSOT (`scripts/lib/is-main.mjs`) の import 解決に失敗したとき、hook が
 * **exit 2 (block)** で終了することを固定する (#3999 AC3)。
 *
 * `.claude/hooks/gate-approve.mjs` と同一の失敗 class。Claude Code は exit 2 のみを block と
 * して扱うため、`ERR_MODULE_NOT_FOUND` の既定 exit 1 のままだと tool 実行が継続し、
 * **QM アカウントからの `gh pr create` が素通しする**。
 *
 * 陽性対照 (is-main.mjs を置いた tree で `gh pr create` を含まないコマンドが exit 0 無出力)
 * を併置し、「常に落ちているだけ」と区別する。
 */
describe('fail-closed — 判定 SSOT の import 解決失敗 (#3999 AC3)', () => {
	const HOOK = 'scripts/claude-hook-prevent-qa-account-pr.mjs';
	// gh auth status を spawn させないため、hook の検出対象外コマンドを使う
	const HARMLESS_CMD = 'git status --short';

	it('陽性対照: is-main.mjs のある tree では対象外コマンドを素通しする (exit 0 / 無出力)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(HARMLESS_CMD),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(0);
		expect(res.combined.trim()).toBe('');
	}, 30_000);

	it('is-main.mjs が無い tree → exit 2 (exit 1 = 素通しに倒れない)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: false,
			stdin: bashPayload('gh pr create --draft --title "x"'),
		});
		expect(
			res.status,
			`exit 1 は Claude Code では non-blocking error として tool 実行が継続する。出力:\n${res.combined}`,
		).toBe(2);
		expect(res.stderr).toContain('scripts/lib/is-main.mjs');
		expect(res.stderr).toContain('fail-closed');
	}, 30_000);

	/** module は読めるが `isMain` を export していない劣化パターン。`gate-approve` と同一 class。 */
	it('is-main.mjs が isMain を export していない tree → exit 2', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			isMainSource: IS_MAIN_WITHOUT_EXPORT,
			stdin: bashPayload('gh pr create --draft --title "x"'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('isMain を export していません');
	}, 30_000);
});
