/**
 * tests/unit/hooks/heavy-run-guard.test.ts
 *
 * 並行実行ガード (heavy-run-lock) の 4 欠陥に対する回帰テスト。
 * すべて 2026-07-29 夜間ランの**実測**を fixture の実名にしている。
 *
 * | Issue | 欠陥 | ここで固定する不変条件 |
 * |---|---|---|
 * | #4083 | lock の寿命がセッションに紐づき、走行中のプロセスを保護しないまま解放される | lock の生存判定は**保護対象プロセスの実在**に紐づく (両方向) |
 * | #4069 | 中断後の掃除が「全 node kill」しかなく、lock 保持者を巻き込む | 所有権に基づく掃除計画 + 全 kill コマンドの検出 |
 * | #4071 | 判定がコマンド文字列の部分一致で、`gh issue create` すら BLOCK する | 判定は**先頭トークン + サブコマンドの構造**で行う |
 * | #4076 | worktree からの push をメインクローンの現在ブランチで判定する | branch は push refspec / コマンドの cwd から解決する |
 *
 * ガードを弱めていないこと (ADR-0006) を同じ file で対にして固定する — 「通るように
 * なった」だけの test は、判定を常に false に潰しても PASS してしまうため。
 *
 * 関連: docs/sessions/agent-concurrency.md / .claude/hooks/heavy-run-lock.mjs
 *
 * cspell 例外 (本 file 限定): `sess` = session id の fixture 値。
 */
// cspell:ignore sess

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	acquire,
	isStale,
	lockPath,
	readLock,
	releaseUnlessGuarded,
} from '../../../scripts/lib/agent-lock.mjs';
import {
	isBulkProcessKillCommand,
	isHeavyCommand,
	resolveCommandCwd,
	resolvePushRefBranch,
} from '../../../scripts/lib/agent-lock-policy.mjs';
import {
	collectDescendants,
	findHeavyProcesses,
	isHeavyProcessCmdline,
	planProcessCleanup,
} from '../../../scripts/lib/heavy-process.mjs';

/** 生存していないことが確実な PID。Windows / POSIX とも未使用値を使う。 */
const DEAD_PID = 0x7ffffff0;

/**
 * `snapshotProcesses()` と同じ形のプロセス表を組み立てる。
 * 実プロセスを起動せずに「誰の子孫か」「何が走っているか」を固定できる。
 */
function makeTable(rows: { pid: number; ppid: number; name: string; cmd: string }[]) {
	return new Map(rows.map((r) => [r.pid, r]));
}

// ---------------------------------------------------------------------------
// #4071 — 判定を「実行される先頭コマンド + サブコマンド」の構造で行う
// ---------------------------------------------------------------------------

describe('#4071 コマンド判定は構造で行う (部分一致で誤爆しない)', () => {
	it.each([
		// 実測 3 例。いずれも重い検証を 1 つも起動しないのに BLOCK された。
		'gh issue create --title "svelte-check がローカルでしか回らない" --body-file tmp/issue-svelte-check-infra.md',
		'gh issue create --title "前提チェックが pre-ready にしか無い" --body-file tmp/issue-b.md',
		'gh issue create --title "npx vitest run が 1 時間 flush しない" --body-file tmp/issue-c.md',
	])('AC1: 検証を起動しないコマンドは引数に検証名を含んでも通す: %s', (command) => {
		expect(isHeavyCommand(command)).toBe(false);
	});

	it.each([
		'gh pr edit 4081 --body-file tmp/pr-bodies/pre-ready-gate.md',
		'node scripts/check-pr-body.mjs --pr 4081',
		'git commit -m "fix: pre-ready の svelte-check step を直す"',
		'gh issue comment 4071 --body "npm run pre-ready は通っています"',
	])('AC1: 本文・パス・引数に検証名が出てくるだけでは通す: %s', (command) => {
		expect(isHeavyCommand(command)).toBe(false);
	});

	it.each([
		'npm run pre-ready -- --pr 4081',
		'node scripts/pre-ready.mjs --pr 4081',
		'npx vitest run tests/unit/hooks/heavy-run-guard.test.ts',
		'vitest',
		'npx playwright test --project=chromium',
		'npx svelte-check --threshold error',
		'npm run test:unit',
		'npm run check',
		'npm test',
	])('AC2: 実際に起動するコマンドは引き続き BLOCK する: %s', (command) => {
		expect(isHeavyCommand(command)).toBe(true);
	});

	it('AC2: 前置き / シェル経由の回避を許さない (ガードを弱めない)', () => {
		expect(isHeavyCommand('echo start && npx vitest run')).toBe(true);
		expect(isHeavyCommand('cd tests ; npm run pre-ready')).toBe(true);
		expect(isHeavyCommand('bash -c "npx vitest run"')).toBe(true);
		expect(isHeavyCommand('env CI=1 npx vitest run')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// #4076 — branch は push 対象から解決する
// ---------------------------------------------------------------------------

describe('#4076 push 対象ブランチで判定する', () => {
	it('AC1: refspec から push 対象ブランチを取る (実測ケース)', () => {
		expect(resolvePushRefBranch('git push origin fix/3980-3981-stripe-plan-resolution')).toBe(
			'fix/3980-3981-stripe-plan-resolution',
		);
		expect(
			resolvePushRefBranch('git push --force-with-lease origin fix/3980-3981-stripe-plan-resolution'),
		).toBe('fix/3980-3981-stripe-plan-resolution');
		expect(resolvePushRefBranch('git push origin HEAD:refs/heads/fix/4017-dependency-review-waiver')).toBe(
			'fix/4017-dependency-review-waiver',
		);
	});

	it('AC1: refspec が無ければ null (cwd 解決にフォールバックする)', () => {
		expect(resolvePushRefBranch('git push')).toBeNull();
		expect(resolvePushRefBranch('git push -u origin HEAD')).toBeNull();
		expect(resolvePushRefBranch('git status')).toBeNull();
	});

	it('AC2: cwd は「コマンドが実行される場所」から解決する', () => {
		const main = 'E:\\Github\\ganbari-quest-dev';
		// worktree へ cd してから push する形
		expect(
			resolveCommandCwd('cd .claude/worktrees/agent-a1ef5ad9e76bd9d2f && git push origin HEAD', main),
		).toBe(join(main, '.claude', 'worktrees', 'agent-a1ef5ad9e76bd9d2f'));
		// git -C 指定
		expect(
			resolveCommandCwd('git -C .claude/worktrees/agent-a1ef5ad9e76bd9d2f push origin HEAD', main),
		).toBe(join(main, '.claude', 'worktrees', 'agent-a1ef5ad9e76bd9d2f'));
		// 手がかりが無ければ hook payload の cwd
		expect(resolveCommandCwd('git push origin HEAD', main)).toBe(main);
	});

	it('AC3: 同一ブランチの二重作業は引き続き検出できる (ガードを弱めない)', () => {
		// メインクローン = fix/4017 / worktree = fix/3980 の実測構成。
		// worktree からの push は自分のブランチで判定され、
		// 同じ fix/4017 を押す 2 本目は同じ key に落ちる。
		const worktreePush = resolvePushRefBranch('git push origin fix/3980-3981-stripe-plan-resolution');
		const mainPush = resolvePushRefBranch('git push origin fix/4017-dependency-review-waiver');
		expect(worktreePush).not.toBe(mainPush);
		expect(resolvePushRefBranch('git push --force-with-lease origin fix/4017-dependency-review-waiver')).toBe(
			mainPush,
		);
	});
});

// ---------------------------------------------------------------------------
// #4069 — 所有権に基づく掃除 / 全 kill の検出
// ---------------------------------------------------------------------------

describe('#4069 所有権に基づく掃除', () => {
	const table = makeTable([
		{ pid: 100, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
		{ pid: 110, ppid: 100, name: 'bash.exe', cmd: 'bash -c ...' },
		{ pid: 120, ppid: 110, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4081' },
		{ pid: 121, ppid: 120, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs run' },
		// 別セッション (lock 保持者)。PR #4063 / worktree agent-ae876294c8c0a2e71
		{ pid: 200, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
		{ pid: 210, ppid: 200, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4063' },
	]);

	it('AC1: 自分の子孫だけを列挙する (全 node を対象にしない)', () => {
		expect(collectDescendants(table, 100).sort()).toEqual([110, 120, 121]);
		const plan = planProcessCleanup({ table, ownerPid: 100, protectedPids: [] });
		expect(plan.targets.map((p) => p.pid).sort()).toEqual([120, 121]);
		// 他セッションのプロセスは候補にすら入らない
		expect(plan.targets.some((p) => p.pid === 210)).toBe(false);
	});

	it('AC2: lock 保持者とその子孫は除外される', () => {
		const plan = planProcessCleanup({ table, ownerPid: 100, protectedPids: [120] });
		expect(plan.targets.map((p) => p.pid)).toEqual([]);
		expect(plan.excluded.map((e) => e.pid).sort()).toEqual([120, 121]);
		expect(plan.excluded.every((e) => e.reason === 'lock-holder')).toBe(true);
	});

	it.each([
		'taskkill /F /IM node.exe',
		'taskkill /IM node.exe /F /T',
		'pkill -f node',
		'killall node',
		'Stop-Process -Name node -Force',
	])('AC4: 全 node kill を検出する: %s', (command) => {
		expect(isBulkProcessKillCommand(command)).toBe(true);
	});

	it.each([
		'taskkill /F /PID 33176',
		'kill -9 33176',
		'Stop-Process -Id 33176',
		'node scripts/agent-cleanup.mjs --kill',
	])('AC4: PID 指定の停止は通す (掃除手段を潰さない): %s', (command) => {
		expect(isBulkProcessKillCommand(command)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// #4083 — lock の寿命は保護対象プロセスに紐づく
// ---------------------------------------------------------------------------

describe('#4083 lock の生存判定はプロセスの実在に紐づく', () => {
	let dir: string;
	const original = process.env.AGENT_LOCK_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'heavy-run-guard-'));
		process.env.AGENT_LOCK_DIR = dir;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.AGENT_LOCK_DIR;
		else process.env.AGENT_LOCK_DIR = original;
		rmSync(dir, { recursive: true, force: true });
	});

	it('AC2: lock ファイルが無くても、重い検証プロセスが実在すれば検出できる', () => {
		// 21:11 起動の pre-ready が生存中 (起動元セッションは終了済) という実測構成。
		const table = makeTable([
			{ pid: 33176, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4081' },
			{ pid: 40000, ppid: 1, name: 'node.exe', cmd: 'node scripts/check-pr-body.mjs --pr 4080' },
		]);
		const found = findHeavyProcesses(table, { excludePids: [] });
		expect(found.map((p) => p.pid)).toEqual([33176]);
		// 掃除 script や PR body 検査は重い検証ではない
		expect(isHeavyProcessCmdline('node scripts/check-pr-body.mjs --pr 4080')).toBe(false);
		expect(isHeavyProcessCmdline('node scripts/pre-ready.mjs --pr 4081')).toBe(true);
		expect(isHeavyProcessCmdline('node node_modules/vitest/vitest.mjs run')).toBe(true);
	});

	it('AC2: 自分が今から起動する分は除外できる (自分の子孫を誤検出しない)', () => {
		const table = makeTable([
			{ pid: 33176, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4081' },
		]);
		expect(findHeavyProcesses(table, { excludePids: [33176] })).toEqual([]);
	});

	it('AC1: 保護対象プロセスが生きている間は、持ち主が死んでいても stale にしない', () => {
		const holder = {
			key: 'heavy',
			ownerPid: DEAD_PID, // セッションは終了済
			guardedPids: [process.pid], // 検証プロセスは生存中
			startedAt: Date.now(),
			ttlMs: 60_000,
		};
		expect(isStale(holder, Date.now())).toBe(false);
	});

	it('AC1: TTL を超えていても保護対象が生きていれば奪えない', () => {
		const now = 10_000_000;
		writeFileSync(
			lockPath('heavy'),
			JSON.stringify({
				key: 'heavy',
				ownerPid: DEAD_PID,
				guardedPids: [process.pid],
				startedAt: now - 5 * 60 * 60 * 1000,
				ttlMs: 60 * 60 * 1000,
			}),
		);
		const result = acquire('heavy', { sessionId: 'sess-other', now });
		expect(result.ok).toBe(false);
		expect(result.holder?.guardedPids).toEqual([process.pid]);
	});

	it('AC3: プロセスが死んでいれば stale として奪える (#4069 AC3 と同一判定)', () => {
		writeFileSync(
			lockPath('heavy'),
			JSON.stringify({
				key: 'heavy',
				ownerPid: DEAD_PID,
				guardedPids: [DEAD_PID],
				startedAt: Date.now(),
			}),
		);
		const result = acquire('heavy', { sessionId: 'sess-new' });
		expect(result.ok).toBe(true);
		expect(readLock('heavy')?.sessionId).toBe('sess-new');
	});

	it('AC1: 解放は保護対象が生きている間 no-op になる (走行中に lock が消えない)', () => {
		acquire('heavy', { sessionId: 'sess-1', ownerPid: process.pid, target: 'PR #4081' });
		const kept = releaseUnlessGuarded('heavy', { sessionId: 'sess-1' }, [process.pid]);
		expect(kept.released).toBe(false);
		expect(readLock('heavy')?.guardedPids).toEqual([process.pid]);

		// 検証プロセスが終われば解放される
		const done = releaseUnlessGuarded('heavy', { sessionId: 'sess-1' }, [DEAD_PID]);
		expect(done.released).toBe(true);
		expect(readLock('heavy')).toBeNull();
	});
});
