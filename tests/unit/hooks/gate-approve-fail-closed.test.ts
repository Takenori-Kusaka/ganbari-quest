/**
 * tests/unit/hooks/gate-approve-fail-closed.test.ts (#4057 / #4075 / #4082)
 *
 * ADR-0056 approve gate を **fail-closed** に倒した 3 欠陥の回帰テスト。
 *
 * 3 件は別々の Issue だが root class は 1 つ — **gate の発火条件を「守るべき不変条件
 * (= approve 行為であること)」ではなく「コマンドの表層的な書き方 / 実行経路の種別」に
 * 結びつけていた**こと。表層依存の検出は必ず変種で回避されるため、本 test は
 * 「素通り (exit 0) がありえないこと」を変種ごとに固定する。
 *
 * 固定する不変条件:
 *   1. (#4057) PR 番号がリテラルで現れない形 (ループ変数 / コマンド置換 / PowerShell 変数) でも
 *      approve 行為として捕捉し、番号が確定できないなら **BLOCK** する
 *   2. (#4075) sibling module (`./command-execution-tools.mjs`) が欠落した checkout でも
 *      exit 1 (= 素通し) に倒れず exit 2 (= block) になる
 *   3. (#4082 R2) `CLAUDE_SUBAGENT_ID` が立っていても **approve mutation は素通ししない**
 *   4. (#4082 R1) 汎用コード実行 MCP ツール経路 (`mcp__ide__executeCode`) が検査対象に入る
 *
 * 併置する陽性対照 (ADR-0006 — guard を弱めていないこと):
 *   - 正規の approve 経路 (PR 番号リテラル + evidence 適合) は引き続き通る
 *   - approve と無関係なコマンドは引き続き素通りする (過剰 block していない)
 *
 * 関連: ADR-0056 / ADR-0061 (same-class-N→guard) / #3999 (先行する同 class の fail-open)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	COMMAND_EXECUTION_MATCHER,
	COMMAND_EXECUTION_TOOLS,
	matcherCoversTool,
	SHELL_COMMAND_TOOLS,
} from '../../../.claude/hooks/command-execution-tools.mjs';
import {
	extractPrNumber,
	extractPrNumbers,
	isApproveAction,
	isReadOnlyApproveInspection,
	MIN_REASON_LENGTH,
	REQUIRED_OBJECT_COUNT,
	resolveInspectableCommands,
} from '../../../.claude/hooks/gate-approve.mjs';
import { bashPayload, runHookInIsolatedTree } from '../helpers/hook-tree-probe';

// ---------------------------------------------------------------------------
// #4057 — PR 番号をリテラルで含まないコマンド形 (QM 実測、2026-07-29)
// ---------------------------------------------------------------------------

/**
 * QM セッションで **実際に素通りした**コマンド (Issue #4057 本文の再現形)。
 *
 * 番号をリテラルで書いた `.../pulls/4002/reviews` は同時刻に正しく BLOCK されたのに、
 * ループ変数 `$n` にしただけで `isApproveAction === false` になり evidence 検証ごと素通りした。
 */
const LOOP_VARIABLE_APPROVE = [
	'for n in 4002 4010; do',
	'  GH_TOKEN=$(gh auth token --user ganbariquestsupport-lab) \\',
	'    gh api repos/Takenori-Kusaka/ganbari-quest/pulls/$n/reviews -X POST -f event=APPROVE -f body=LGTM',
	'done',
].join('\n');

/** 同時刻に **正しく BLOCK された**リテラル形 (陽性対照)。 */
const LITERAL_APPROVE =
	'gh api repos/Takenori-Kusaka/ganbari-quest/pulls/4002/reviews -X POST -f event=APPROVE';

/** コマンド置換で PR 番号を埋める形 (同 class の別変種)。 */
const COMMAND_SUBSTITUTION_APPROVE =
	"gh api repos/Takenori-Kusaka/ganbari-quest/pulls/$(gh pr list -L1 --json number -q '.[0].number')/reviews -X POST -f event=APPROVE";

/** PowerShell 変数展開形 (同 class の別変種、#4001 で塞いだ経路の書き方違い)。 */
const POWERSHELL_VARIABLE_APPROVE =
	'& \'gh\' api "repos/Takenori-Kusaka/ganbari-quest/pulls/$n/reviews" -X POST -f event=APPROVE';

describe('#4057 — PR 番号がリテラルで現れない approve 形', () => {
	it('ループ変数形 ($n) を approve 行為として捕捉する (実測の素通り形)', () => {
		expect(isApproveAction(LOOP_VARIABLE_APPROVE)).toBe(true);
	});

	it('ループ変数形からは PR 番号を確定できない → null (ループ列挙値 4002 を推測しない)', () => {
		// `for n in 4002 4010` の 4002 を拾うと、evidence が 4002 の分しか無いのに
		// 4010 まで approve が通る。「近くにある数字」を PR 番号として採用しない。
		expect(extractPrNumber(LOOP_VARIABLE_APPROVE)).toBe(null);
		expect(extractPrNumbers(LOOP_VARIABLE_APPROVE)).toEqual([]);
	});

	it('コマンド置換形を approve 行為として捕捉し、番号は確定できない', () => {
		expect(isApproveAction(COMMAND_SUBSTITUTION_APPROVE)).toBe(true);
		expect(extractPrNumbers(COMMAND_SUBSTITUTION_APPROVE)).toEqual([]);
	});

	it('PowerShell 変数展開形を approve 行為として捕捉し、番号は確定できない', () => {
		expect(isApproveAction(POWERSHELL_VARIABLE_APPROVE)).toBe(true);
		expect(extractPrNumbers(POWERSHELL_VARIABLE_APPROVE)).toEqual([]);
	});

	it('陽性対照: リテラル形は従来どおり捕捉し番号も取れる', () => {
		expect(isApproveAction(LITERAL_APPROVE)).toBe(true);
		expect(extractPrNumbers(LITERAL_APPROVE)).toEqual([4002]);
	});

	it('1 コマンドで複数 PR を approve する形は全 PR 番号を返す (1 件の evidence で 2 件通さない)', () => {
		expect(extractPrNumbers('gh pr merge 4002 --squash && gh pr merge 4010 --squash')).toEqual([
			4002, 4010,
		]);
	});

	it('過剰 block しない: pulls コレクション POST (= PR 作成) は approve 判定に入らない', () => {
		expect(isApproveAction('gh api repos/Takenori-Kusaka/ganbari-quest/pulls -X POST')).toBe(false);
	});

	it('過剰 block しない: 変数展開があっても pulls 配下でなければ対象外', () => {
		expect(isApproveAction('gh api repos/$OWNER/$REPO/issues/$n/comments -X POST')).toBe(false);
	});
});

describe('#4057 — hook 実行 (exit code) で素通りしないことを固定する', () => {
	const HOOK = '.claude/hooks/gate-approve.mjs';

	it('ループ変数形の approve → exit 2 (旧実装は exit 0 で素通りした)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(LOOP_VARIABLE_APPROVE),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('PR 番号');
	}, 30_000);

	it('陽性対照: approve と無関係なコマンドは素通りする (exit 0 / 無出力)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload('gh pr view 4057 --json title'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(0);
		expect(res.combined.trim()).toBe('');
	}, 30_000);
});

// ---------------------------------------------------------------------------
// #4095 QM Re-Review — 棚卸から漏れていた literal な approve 経路 3 種
//
// いずれも「変数経由 / base64 / eval」でも「未棚卸のコード実行ツール」でもない **literal 形**で、
// ADR-0056 の accepted residual 定義に該当しない。QM が隔離 tree で exit 0 を実測した形を固定する。
// ---------------------------------------------------------------------------

const HOOK_PATH = '.claude/hooks/gate-approve.mjs';

describe('#4095 O-1 — gh pr review の短縮 flag (-a)', () => {
	it('`-a` (--approve の正式な短縮形) を approve 行為として捕捉する (QM 実測の素通り形)', () => {
		expect(isApproveAction('gh pr review 4010 -a --body ok')).toBe(true);
	});

	it('陽性対照: 長形 --approve は従来どおり捕捉する', () => {
		expect(isApproveAction('gh pr review 4010 --approve --body ok')).toBe(true);
	});

	it('short flag cluster (-ab body = --approve --body) も捕捉する', () => {
		expect(isApproveAction('gh pr review 4010 -ab LGTM')).toBe(true);
	});

	it('過剰 block しない: -c (--comment) / -r (--request-changes) は approve ではない', () => {
		expect(isApproveAction('gh pr review 4010 -c --body "質問です"')).toBe(false);
		expect(isApproveAction('gh pr review 4010 -r --body "BLOCK"')).toBe(false);
		expect(isApproveAction('gh pr review 4010 -R owner/repo -c -b x')).toBe(false);
	});

	it('短縮 flag 形は read-only 参照とみなさない (subagent でも block 側)', () => {
		expect(isReadOnlyApproveInspection('gh pr review 4010 -a')).toBe(false);
	});

	it('hook 実行: `-a` 形は evidence 不在で exit 2 (旧実装は exit 0)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002],
			stdin: bashPayload('gh pr review 4010 -a --body ok'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);
});

describe('#4095 O-2 — GraphQL の approve 相当 mutation', () => {
	const GRAPHQL_APPROVE =
		'gh api graphql -f query=\'mutation{addPullRequestReview(input:{pullRequestId:"PR_kwABC",event:APPROVE,body:"LGTM"}){clientMutationId}}\'';
	const GRAPHQL_MERGE =
		'gh api graphql -f query=\'mutation{mergePullRequest(input:{pullRequestId:"PR_kwABC"}){clientMutationId}}\'';
	const GRAPHQL_READ =
		'gh api graphql -f query=\'query{repository(owner:"o",name:"r"){pullRequest(number:4010){title}}}\'';

	it('addPullRequestReview mutation を approve 行為として捕捉する (QM 実測の素通り形)', () => {
		expect(isApproveAction(GRAPHQL_APPROVE)).toBe(true);
	});

	it('mergePullRequest mutation も捕捉する', () => {
		expect(isApproveAction(GRAPHQL_MERGE)).toBe(true);
	});

	it('GraphQL は node ID 指定のため PR 番号を確定できない → 確定不能として扱う', () => {
		expect(extractPrNumbers(GRAPHQL_APPROVE)).toEqual([]);
		expect(isReadOnlyApproveInspection(GRAPHQL_APPROVE)).toBe(false);
	});

	it('過剰 block しない: 読み取り query は approve 判定に入らない', () => {
		expect(isApproveAction(GRAPHQL_READ)).toBe(false);
	});

	it('過剰 block しない: review comment 追加 mutation は approve ではない', () => {
		expect(
			isApproveAction(
				'gh api graphql -f query=\'mutation{addPullRequestReviewComment(input:{body:"nit"}){clientMutationId}}\'',
			),
		).toBe(false);
	});

	it('hook 実行: GraphQL approve は evidence の有無に関わらず exit 2', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002, 4010],
			stdin: bashPayload(GRAPHQL_APPROVE),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);
});

describe('#4095 O-3 — 別 PR の evidence で approve が通らない', () => {
	/**
	 * QM 実測 (evidence は 4002 のみ存在):
	 *   exit=0  for n in 4002 4010; do gh pr merge $n --squash; done # rollup for 4002
	 *   exit=0  gh pr merge $TARGET --squash --delete-branch # tracked in 4002
	 *   exit=2  for n in 4002 4010; do gh pr merge $n --squash; done   ← literal が無ければ塞がる
	 *
	 * = 番号確定が「同一行 / コマンド全体にある任意の数字」に依存しており、**実際に叩かれる PR**
	 * ではなく近くの数字を採っていた。既存の `extractPrNumbers(LOOP_VARIABLE_APPROVE) === []` は
	 * 「他に literal 数字が無い」形しか固定しておらず、この分岐を通していなかった。
	 */
	const LOOP_WITH_LITERAL_NEARBY =
		'for n in 4002 4010; do gh pr merge $n --squash; done # rollup for 4002';
	const VARIABLE_WITH_LITERAL_COMMENT =
		'gh pr merge $TARGET --squash --delete-branch # tracked in 4002';

	it('ループ列挙値 / コメント中の literal 番号を PR 番号として採用しない', () => {
		expect(extractPrNumbers(LOOP_WITH_LITERAL_NEARBY)).toEqual([]);
		expect(extractPrNumbers(VARIABLE_WITH_LITERAL_COMMENT)).toEqual([]);
	});

	it('hook 実行: 4002 の evidence があっても $n loop は exit 2', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002],
			stdin: bashPayload(LOOP_WITH_LITERAL_NEARBY),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('PR 番号');
	}, 30_000);

	it('hook 実行: 4002 の evidence があっても $TARGET + literal コメント形は exit 2', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002],
			stdin: bashPayload(VARIABLE_WITH_LITERAL_COMMENT),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);

	it('陽性対照: evidence のある PR をリテラル指定した merge は通る (過剰 block していない)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002],
			stdin: bashPayload('gh pr merge 4002 --squash'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(0);
	}, 30_000);

	it('複数 PR をリテラル指定した形は、evidence の無い側で block される', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK_PATH,
			withIsMain: true,
			evidencePrNumbers: [4002],
			stdin: bashPayload('gh pr merge 4002 --squash && gh pr merge 4010 --squash'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('4010');
	}, 30_000);

	it('番号は同一 invocation の argv から取る: 別 invocation の literal を混ぜない', () => {
		// `gh pr view 4002` の 4002 は merge 対象ではない。旧実装は行全体を走査していた。
		expect(extractPrNumbers('gh pr view 4002 --json title; gh pr merge $PR --squash')).toEqual([]);
	});

	it('flag の値を positional (PR 番号) と誤認しない', () => {
		expect(extractPrNumbers('gh pr merge --repo Takenori-Kusaka/ganbari-quest 4002')).toEqual([
			4002,
		]);
	});
});

// ---------------------------------------------------------------------------
// #4075 — sibling static import の欠落による fail-open
// ---------------------------------------------------------------------------

describe('#4075 — sibling module 欠落時に fail-open しない', () => {
	const HOOK = '.claude/hooks/gate-approve.mjs';
	const SIBLING = '.claude/hooks/command-execution-tools.mjs';
	const APPROVE_CMD = 'gh pr merge 4075 --squash';

	it('command-execution-tools.mjs が無い tree で approve → exit 2 (exit 1 = 素通しに倒れない)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			omitRelPaths: [SIBLING],
			stdin: bashPayload(APPROVE_CMD),
		});
		expect(
			res.status,
			`exit 1 は Claude Code では non-blocking error として tool 実行が継続する (= approve 素通し)。出力:\n${res.combined}`,
		).toBe(2);
		expect(res.stderr).toContain('command-execution-tools.mjs');
	}, 30_000);

	it('陽性対照: sibling が揃った tree では evidence 不在を理由に exit 2 になる', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(APPROVE_CMD),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('evidence file 不在');
	}, 30_000);
});

/**
 * #4075 AC2 — **sibling を 1 本足しただけで fail-open が復活する構造**を機械的に閉じる。
 *
 * 「1 つの import を fail-closed 化したが、同種の import 全体には及んでいない」という
 * 網羅漏れ (ADR-0061 §same-class-N→guard) が #3999 → #4075 で 2 回起きた。hook 本文を
 * 静的に読み、**相対 module の static import が 0 件**であることを assert する。
 */
describe('#4075 AC2 — hook の相対 import は全て dynamic (fitness function)', () => {
	const SETTINGS_PATH = resolve(process.cwd(), '.claude/settings.json');

	/** settings.json に登録されている hook script の repo 相対パスを集める。 */
	function registeredHookScripts(): string[] {
		const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as {
			hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
		};
		const paths = new Set<string>();
		for (const entries of Object.values(settings.hooks ?? {})) {
			for (const entry of entries) {
				for (const hook of entry.hooks ?? []) {
					const match = (hook.command ?? '').match(/(?:^|\s)((?:\.claude|scripts)\/\S+\.mjs)/);
					if (match?.[1]) paths.add(match[1]);
				}
			}
		}
		return [...paths].sort();
	}

	/**
	 * #4571 / ADR-0068: settings.json から呼び出しを外したが、段階的な再導入のため本体を残している
	 * hook。**残置中も fail-closed 性を検査し続ける** — 再登録の日に「静かに fail-open へ戻っていた」
	 * を起こさないため (未登録 = 検査対象外、にすると残置期間ぶんだけ腐る)。
	 */
	const RETAINED_UNREGISTERED_HOOKS = ['.claude/hooks/gate-approve.mjs'];

	const scripts = [...new Set([...registeredHookScripts(), ...RETAINED_UNREGISTERED_HOOKS])].sort();

	it('抽出が空振りしていない (0 件なら以降が vacuous pass になる)', () => {
		expect(scripts.length).toBeGreaterThanOrEqual(3);
		expect(scripts).toContain('.claude/hooks/gate-approve.mjs');
	});

	it('残置 hook の本体が実在する (消えたら本 describe が静かに空を検査する)', () => {
		for (const relPath of RETAINED_UNREGISTERED_HOOKS) {
			expect(
				existsSync(resolve(process.cwd(), relPath)),
				`${relPath} が無い。削除したなら RETAINED_UNREGISTERED_HOOKS からも外し、ADR-0068 を改訂すること`,
			).toBe(true);
		}
	});

	it.each(
		scripts.map((p) => [p] as const),
	)('%s に相対 module の static import が無い', (relPath) => {
		const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
		// quote style を限定しない (#4095 申し送り 1): シングルクォート限定だと
		// `from "./x.mjs"` を 0 件と誤判定し、guard が静かに空振りする。
		const staticRelativeImports = [
			...source.matchAll(/^\s*import\s+[^;]*?from\s+(['"])(\.[^'"]+)\1/gm),
		].map((m) => m[2]);
		expect(
			staticRelativeImports,
			`static import は解決失敗が exit 1 (= 素通し) になる。dynamic import + exit 2 に倒すこと (#3999 / #4075)`,
		).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// #4082 R2 — CLAUDE_SUBAGENT_ID の無条件 allow
// ---------------------------------------------------------------------------

describe('#4082 R2 — subagent context でも approve mutation は素通ししない', () => {
	const HOOK = '.claude/hooks/gate-approve.mjs';

	it('subagent context + gh pr merge → exit 2 (旧実装は無条件 allow だった)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			env: { CLAUDE_SUBAGENT_ID: 'adversarial-reviewer-1' },
			stdin: bashPayload('gh pr merge 4082 --squash'),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);

	it('subagent context + REST 直叩き approve → exit 2', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			env: { CLAUDE_SUBAGENT_ID: 'adversarial-reviewer-1' },
			stdin: bashPayload(LITERAL_APPROVE),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);

	it('recursive loop 防止は保つ: subagent が review 一覧を GET で読むのは通す', () => {
		const readOnly =
			'gh api repos/Takenori-Kusaka/ganbari-quest/pulls/4082/reviews --jq ".[].state"';
		expect(isReadOnlyApproveInspection(readOnly)).toBe(true);
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			env: { CLAUDE_SUBAGENT_ID: 'adversarial-reviewer-1' },
			stdin: bashPayload(readOnly),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(0);
	}, 30_000);

	it('subagent 以外の context では同じ GET も evidence gate の対象のまま (検出を弱めない)', () => {
		const readOnly =
			'gh api repos/Takenori-Kusaka/ganbari-quest/pulls/4082/reviews --jq ".[].state"';
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(readOnly),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);

	it('mutation を含む形は subagent でも read-only とみなさない', () => {
		expect(isReadOnlyApproveInspection('gh pr merge 4082 --squash')).toBe(false);
		expect(isReadOnlyApproveInspection(LITERAL_APPROVE)).toBe(false);
		expect(isReadOnlyApproveInspection(LOOP_VARIABLE_APPROVE)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// #4082 R1 — 汎用コード実行 MCP ツール経路
// ---------------------------------------------------------------------------

describe('#4082 R1 — 判定軸を「shell か」から「任意の副作用を起こせるか」に変える', () => {
	it('SSOT に汎用コード実行 MCP (mcp__ide__executeCode) が含まれる', () => {
		expect(COMMAND_EXECUTION_TOOLS).toContain('mcp__ide__executeCode');
		expect(SHELL_COMMAND_TOOLS).not.toContain('mcp__ide__executeCode');
	});

	it('matcher が SSOT の全ツールを覆う', () => {
		for (const tool of COMMAND_EXECUTION_TOOLS) {
			expect(matcherCoversTool(COMMAND_EXECUTION_MATCHER, tool)).toBe(true);
		}
	});

	it('executeCode payload (tool_input.code) を検査対象にする — shell 文字列そのままの形', () => {
		const r = resolveInspectableCommands({
			tool_name: 'mcp__ide__executeCode',
			tool_input: { code: 'import os; os.system("gh pr merge 4082 --squash")' },
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.commands.some((c) => isApproveAction(c))).toBe(true);
			expect(r.commands.flatMap((c) => extractPrNumbers(c))).toContain(4082);
		}
	});

	it('executeCode payload — 言語構文で分断された引数配列形も掴む', () => {
		const r = resolveInspectableCommands({
			tool_name: 'mcp__ide__executeCode',
			tool_input: { code: 'import subprocess; subprocess.run(["gh","pr","merge","4082"])' },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(true);
	});

	it('過剰 block しない: approve と無関係な executeCode は素通り判定になる', () => {
		const r = resolveInspectableCommands({
			tool_name: 'mcp__ide__executeCode',
			tool_input: { code: 'import pandas as pd; print(pd.read_csv("data.csv").head())' },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(false);
	});

	it('検査できる文字列が 1 つも無い payload は block (allow に倒さない)', () => {
		const r = resolveInspectableCommands({
			tool_name: 'mcp__ide__executeCode',
			tool_input: { code: 42 },
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/検査/);
	});

	it('shell ツールは従来どおり tool_input.command 必須 (非文字列は block)', () => {
		const r = resolveInspectableCommands({ tool_name: 'Bash', tool_input: {} });
		expect(r.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 事後監査 (#4082 R3 / R1 の残余に対する検知層)
// ---------------------------------------------------------------------------

describe('事後監査 — 経路に依存しない approve 検知 (#4082 AC5)', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `approve-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(resolve(tmpDir, 'tmp', 'adversarial-evidence'), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	function writeEvidence(prNumber: number) {
		const reason = 'X'.repeat(MIN_REASON_LENGTH + 10);
		writeFileSync(
			resolve(tmpDir, 'tmp', 'adversarial-evidence', `${prNumber}.json`),
			JSON.stringify({
				pr_number: prNumber,
				must_object_count: REQUIRED_OBJECT_COUNT,
				objections: [
					{ axis: 'business', reason },
					{ axis: 'UX', reason },
					{ axis: 'security', reason },
				],
			}),
			'utf8',
		);
	}

	it('evidence 不在の APPROVE を未検証 approve として報告する', async () => {
		const { auditApprovals } = await import('../../../scripts/audit-approve-evidence.mjs');
		const result = auditApprovals(
			{ prNumber: 4082, reviews: [{ state: 'APPROVED', user: 'ganbariquestsupport-lab' }] },
			tmpDir,
		);
		expect(result.ok).toBe(false);
		expect(result.unverified).toHaveLength(1);
	});

	it('evidence 適合の APPROVE は報告しない', async () => {
		const { auditApprovals } = await import('../../../scripts/audit-approve-evidence.mjs');
		writeEvidence(4082);
		const result = auditApprovals(
			{ prNumber: 4082, reviews: [{ state: 'APPROVED', user: 'ganbariquestsupport-lab' }] },
			tmpDir,
		);
		expect(result.ok).toBe(true);
		expect(result.unverified).toHaveLength(0);
	});

	it('APPROVE 以外の review は監査対象外 (過剰報告しない)', async () => {
		const { auditApprovals } = await import('../../../scripts/audit-approve-evidence.mjs');
		const result = auditApprovals(
			{ prNumber: 4082, reviews: [{ state: 'COMMENTED', user: 'someone' }] },
			tmpDir,
		);
		expect(result.ok).toBe(true);
	});
});
