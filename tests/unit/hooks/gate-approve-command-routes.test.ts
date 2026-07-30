/**
 * tests/unit/hooks/gate-approve-command-routes.test.ts (#4001)
 *
 * ADR-0056 approve gate の **コマンド実行経路** 側の回帰テスト。
 *
 * 固定する不変条件:
 *   1. PowerShell payload も Bash payload と同様に検査対象になる (gate bypass の直接原因)
 *   2. 判別できない入力 (tool_name 欠落 / command 非文字列 / 未知ツール) を
 *      「approve ではない」に潰さない (fail-closed)
 *   3. Windows / PowerShell の表記ゆれ (gh.exe / 呼び出し演算子 / backtick 継続) を検出する
 *
 * 検出ロジック本体の schema / TTL 検証は gate-approve.test.ts が担当する。
 */

import { describe, expect, it } from 'vitest';

import {
	collectStrings,
	extractPrNumber,
	isApproveAction,
	normalizeCommand,
	resolveInspectableCommands,
} from '../../../.claude/hooks/gate-approve.mjs';

const MERGE_CMD = 'gh pr merge 4001 --squash';

describe('resolveInspectableCommands (#4001 — 判別不能を allow に倒さない)', () => {
	it('Bash payload → command を検査対象として返す', () => {
		const r = resolveInspectableCommands({
			tool_name: 'Bash',
			tool_input: { command: MERGE_CMD },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands).toEqual([MERGE_CMD]);
	});

	it('PowerShell payload も同じく検査対象になる (matcher 拡張後に hook が受け取る形)', () => {
		const r = resolveInspectableCommands({
			tool_name: 'PowerShell',
			tool_input: { command: MERGE_CMD },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(true);
	});

	it('tool_name 欠落 → block (どの実行経路か判別できない)', () => {
		const r = resolveInspectableCommands({ tool_input: { command: MERGE_CMD } });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/tool_name/);
	});

	it('既知ツールなのに command が文字列でない → block (検査対象を読めない)', () => {
		const r = resolveInspectableCommands({ tool_name: 'PowerShell', tool_input: {} });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/command/);
	});

	it('SSOT 未登録ツール → allow せず tool_input 内の全文字列を走査対象にする', () => {
		const r = resolveInspectableCommands({
			tool_name: 'FutureShellTool',
			tool_input: { script: MERGE_CMD },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(true);
	});

	it('SSOT 未登録ツールの引数配列形式も連結して検出する', () => {
		const r = resolveInspectableCommands({
			tool_name: 'FutureShellTool',
			tool_input: { argv: ['gh', 'pr', 'merge', '4001'] },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(true);
	});

	it('無関係な PowerShell コマンドは検査対象になるが approve 判定されない (過剰 block しない)', () => {
		const r = resolveInspectableCommands({
			tool_name: 'PowerShell',
			tool_input: { command: 'Get-ChildItem -Recurse' },
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.commands.some((c) => isApproveAction(c))).toBe(false);
	});
});

describe('isApproveAction — Windows / PowerShell 表記ゆれ (#4001)', () => {
	it('gh.exe 経由 → true', () => {
		expect(isApproveAction('gh.exe pr merge 4001 --squash')).toBe(true);
	});

	it("呼び出し演算子 + 引用符 (& 'gh') → true", () => {
		expect(isApproveAction("& 'gh' pr merge 4001 --squash")).toBe(true);
	});

	it('backtick 行継続をまたぐ → true', () => {
		expect(isApproveAction('gh pr `\n  merge 4001 --squash')).toBe(true);
	});

	it('gh.exe pr review --approve → true', () => {
		expect(isApproveAction('gh.exe pr review 4001 --approve')).toBe(true);
	});
});

describe('extractPrNumber — Windows / PowerShell 表記ゆれ (#4001)', () => {
	it("& 'gh.exe' 経由でも PR 番号を取り出す", () => {
		expect(extractPrNumber("& 'gh.exe' pr merge 4001 --squash")).toBe(4001);
	});
});

describe('normalizeCommand / collectStrings (#4001)', () => {
	it('normalizeCommand は Bash の素の表記を壊さない', () => {
		expect(normalizeCommand(MERGE_CMD)).toBe(MERGE_CMD);
	});

	it('collectStrings は入れ子 object / array から string を集める', () => {
		expect(collectStrings({ a: 'x', b: { c: ['y', 1, null] } }).sort()).toEqual(['x', 'y']);
	});
});
