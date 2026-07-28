/**
 * tests/unit/hooks/command-execution-tools.test.ts (#4001)
 *
 * ADR-0056 approve gate / ADR-0022 L1 の PreToolUse hook が
 * **コマンド実行系ツール全経路**を覆っていることを機械検証する。
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
	it('gate-approve.mjs を登録した PreToolUse entry が SSOT の全ツールを覆う', () => {
		const entries = readSettings().hooks?.PreToolUse ?? [];
		const gateEntries = entries.filter((e) =>
			(e.hooks ?? []).some((h) => (h.command ?? '').includes('gate-approve.mjs')),
		);
		expect(gateEntries.length).toBeGreaterThan(0);
		for (const tool of COMMAND_EXECUTION_TOOLS) {
			const covered = gateEntries.some((e) => matcherCoversTool(e.matcher ?? '', tool));
			expect(covered, `gate-approve が ${tool} 経路を覆っていない (#4001 gate bypass)`).toBe(true);
		}
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
