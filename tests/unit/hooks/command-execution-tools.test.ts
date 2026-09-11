/**
 * tests/unit/hooks/command-execution-tools.test.ts (#4001)
 *
 * 登録済み PreToolUse hook が **コマンド実行系ツール全経路** を覆っていることを機械検証する。
 * (#4571 / ADR-0068 で ADR-0056 approve gate の登録を外したため、対象は「gate-approve と
 *  ADR-0022 L1」から「登録されている hook 全部」に広げた)
 *
 * 背景: `.claude/settings.json` の matcher が `"Bash"` だけだったため、
 * PowerShell ツールで同じコマンドを叩くと hook がそもそも起動せず、
 * approve gate / PR 作成アカウント予防層を丸ごと bypass できた (#4001)。
 * 「列挙の手動メンテは形骸化する」ため、SSOT (COMMAND_EXECUTION_TOOLS) と
 * settings.json の一致をテストで固定する。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	COMMAND_EXECUTION_MATCHER,
	COMMAND_EXECUTION_TOOLS,
	matcherCoversTool,
} from '../../../.claude/hooks/command-execution-tools.mjs';

// vitest の root = リポジトリルート (vitest.config.ts)。import.meta.url は transform 後に
// file: スキームでなくなることがあるため cwd 基準で解決する。
const SETTINGS_PATH = resolve(process.cwd(), '.claude/settings.json');

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string }[] };
type Settings = { hooks?: { PreToolUse?: HookEntry[]; PostToolUse?: HookEntry[] } };

function readSettings(): Settings {
	return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
}

describe('COMMAND_EXECUTION_TOOLS (SSOT)', () => {
	it('Bash と PowerShell を含む (#4001: PowerShell 欠落が gate bypass の原因だった)', () => {
		expect(COMMAND_EXECUTION_TOOLS).toContain('Bash');
		expect(COMMAND_EXECUTION_TOOLS).toContain('PowerShell');
	});

	it('matcher 文字列は SSOT の全ツールを覆う', () => {
		for (const tool of COMMAND_EXECUTION_TOOLS) {
			expect(matcherCoversTool(COMMAND_EXECUTION_MATCHER, tool)).toBe(true);
		}
	});
});

describe('matcherCoversTool', () => {
	it('完全一致で判定する (Bash matcher は PowerShell を覆わない)', () => {
		expect(matcherCoversTool('Bash', 'Bash')).toBe(true);
		expect(matcherCoversTool('Bash', 'PowerShell')).toBe(false);
	});

	it('部分一致で「覆っている」と誤判定しない', () => {
		expect(matcherCoversTool('Bash', 'BashScript')).toBe(false);
	});

	it('不正な正規表現 / 非文字列は覆っていない扱い (fail-closed)', () => {
		expect(matcherCoversTool('Bash|(', 'Bash')).toBe(false);
		expect(matcherCoversTool(undefined as unknown as string, 'Bash')).toBe(false);
	});
});

describe('.claude/settings.json の hook matcher (#4001 AC1 / AC4)', () => {
	// #4571 / ADR-0068: gate-approve.mjs の登録を外したため「gate-approve が全経路を覆う」は
	// もう assert できない。弱めるのではなく **登録されている全 hook** に対象を広げる
	// (対象が 1 本増える = 不変条件としては強くなる)。#4001 の bypass 防止はこちらで維持される。
	it('登録済みの全 PreToolUse hook が SSOT の全ツールを覆う', () => {
		const entries = readSettings().hooks?.PreToolUse ?? [];
		const registered = entries.flatMap((e) =>
			(e.hooks ?? []).map((h) => ({ command: h.command ?? '', matcher: e.matcher ?? '' })),
		);
		expect(registered.length).toBeGreaterThan(0);
		for (const { command, matcher } of registered) {
			for (const tool of COMMAND_EXECUTION_TOOLS) {
				expect(
					matcherCoversTool(matcher, tool),
					`${command} が ${tool} 経路を覆っていない (#4001 gate bypass)`,
				).toBe(true);
			}
		}
	});

	// ADR-0068 は「hook 本体は残し、呼び出しだけ外す」決定。silent な復活を防ぐため、
	// 未登録であること自体を pin する。再登録するときは本 test と ADR-0068 を同時に直すこと
	// (統制水準の変更は決定の改訂であって、設定ファイルの 1 行追加ではない)。
	it('gate-approve.mjs は登録されていない (ADR-0068 / #4571 オーナー判断 A)', () => {
		const entries = readSettings().hooks?.PreToolUse ?? [];
		const commands = entries.flatMap((e) => (e.hooks ?? []).map((h) => h.command ?? ''));
		expect(
			commands.filter((c) => c.includes('gate-approve.mjs')),
			'gate-approve.mjs を再登録するなら ADR-0068 の改訂とセットで行うこと',
		).toEqual([]);
	});

	it('ADR-0022 L1 (claude-hook-prevent-qa-account-pr.mjs) も同じ全経路を覆う', () => {
		const entries = readSettings().hooks?.PreToolUse ?? [];
		const l1Entries = entries.filter((e) =>
			(e.hooks ?? []).some((h) =>
				(h.command ?? '').includes('claude-hook-prevent-qa-account-pr.mjs'),
			),
		);
		expect(l1Entries.length).toBeGreaterThan(0);
		for (const tool of COMMAND_EXECUTION_TOOLS) {
			const covered = l1Entries.some((e) => matcherCoversTool(e.matcher ?? '', tool));
			expect(covered, `ADR-0022 L1 が ${tool} 経路を覆っていない`).toBe(true);
		}
	});

	it('PostToolUse (heavy-run-unlock) も同じ全経路を覆う (lock 取得と解放の非対称を防ぐ)', () => {
		const entries = readSettings().hooks?.PostToolUse ?? [];
		const unlockEntries = entries.filter((e) =>
			(e.hooks ?? []).some((h) => (h.command ?? '').includes('heavy-run-unlock.mjs')),
		);
		expect(unlockEntries.length).toBeGreaterThan(0);
		for (const tool of COMMAND_EXECUTION_TOOLS) {
			const covered = unlockEntries.some((e) => matcherCoversTool(e.matcher ?? '', tool));
			expect(covered, `heavy-run-unlock が ${tool} 経路を覆っていない`).toBe(true);
		}
	});
});
