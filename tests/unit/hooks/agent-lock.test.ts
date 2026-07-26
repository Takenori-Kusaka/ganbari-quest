/**
 * tests/unit/hooks/agent-lock.test.ts
 *
 * 複数エージェントセッション間の排他ロックを unit test する。
 *
 * 検証スコープ:
 *   - agent-lock-policy: どのコマンドを重い検証とみなすか (誤爆しないこと含む)
 *   - agent-lock: 取得 / 二重取得の拒否 / 再入 / 生存判定による stale 回収 / TTL / 解放
 *
 * lock 置き場は `AGENT_LOCK_DIR` で temp ディレクトリへ差し替える。実際の
 * `~/.buzz/.locks` を触ると、並走している別セッションの lock を壊してしまうため。
 *
 * 関連:
 *   - docs/sessions/agent-concurrency.md (運用 SSOT)
 *   - .claude/hooks/heavy-run-lock.mjs / heavy-run-unlock.mjs
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	acquire,
	DEFAULT_TTL_MS,
	describeHolder,
	isProcessAlive,
	isStale,
	lockPath,
	readLock,
	release,
} from '../../../scripts/lib/agent-lock.mjs';
import {
	extractTarget,
	isBranchPublishCommand,
	isHeavyCommand,
	taskKeyFromBranch,
} from '../../../scripts/lib/agent-lock-policy.mjs';

/** 生存していないことが確実な PID。Windows / POSIX とも未使用値を使う。 */
const DEAD_PID = 0x7ffffff0;

describe('isHeavyCommand', () => {
	it.each([
		'npm run pre-ready -- --pr 3992',
		'node scripts/pre-ready.mjs --pr 3992',
		'npx vitest run tests/unit/foo.test.ts',
		'vitest',
		'npx playwright test --project=chromium',
		'npx svelte-check --threshold error',
		'npm run test:unit',
		'npm run check',
	])('重い検証を検出する: %s', (command) => {
		expect(isHeavyCommand(command)).toBe(true);
	});

	it.each([
		'git status',
		'gh pr view 3992 --json reviews',
		'node scripts/check-pr-body.mjs --pr 4002',
		'',
	])('重くないコマンドは通す: %s', (command) => {
		expect(isHeavyCommand(command)).toBe(false);
	});

	it('読み取り専用コマンドの引数に検証コマンド名が入っていても block しない', () => {
		// `grep vitest` を block すると、調査そのものができなくなる。
		expect(isHeavyCommand('grep -rn vitest package.json')).toBe(false);
		expect(isHeavyCommand('rg "npm run pre-ready" docs/')).toBe(false);
	});

	it('無害な前置きを足しても回避できない (セグメント単位で判定する)', () => {
		// 全体の先頭トークンだけを見ると `echo` で読み取り専用と誤判定し、
		// 前置きを 1 つ足すだけで排他を回避できてしまう。
		expect(isHeavyCommand('echo start && npx vitest run')).toBe(true);
		expect(isHeavyCommand('cd tests ; npm run pre-ready')).toBe(true);
		expect(isHeavyCommand('git status | grep foo')).toBe(false);
	});
});

describe('extractTarget', () => {
	it('--pr から PR 番号を拾う', () => {
		expect(extractTarget('npm run pre-ready -- --pr 3996')).toBe('PR #3996');
	});

	it('テストファイル指定を拾う', () => {
		expect(extractTarget('npx vitest run tests/unit/foo.test.ts')).toBe('tests/unit/foo.test.ts');
	});

	it('Windows 区切りのテストファイル指定も拾う', () => {
		expect(extractTarget('npx vitest run tests\\unit\\foo.test.ts')).toBe(
			'tests\\unit\\foo.test.ts',
		);
	});

	it('手がかりが無ければ null', () => {
		expect(extractTarget('npm run check')).toBeNull();
	});
});

describe('isBranchPublishCommand', () => {
	it.each([
		'git push',
		'git push -u origin HEAD',
		'git -C /repo push --force-with-lease',
	])('push を検出する: %s', (command) => {
		expect(isBranchPublishCommand(command)).toBe(true);
	});

	it.each([
		'git status',
		'git log --oneline',
		'gh pr merge 3992',
		'git pushx',
	])('push でないものは通す: %s', (command) => {
		expect(isBranchPublishCommand(command)).toBe(false);
	});

	it('読み取り専用コマンドの引数に push があっても検出しない', () => {
		expect(isBranchPublishCommand('grep -rn "git push" docs/')).toBe(false);
	});
});

describe('taskKeyFromBranch', () => {
	it.each([
		['fix/3963-context-plan-from-db', 'task-3963'],
		['feat/3438-phase2b-dynamodb-repo-teardown', 'task-3438'],
		['infra/4004-playwright-shard', 'task-4004'],
	])('branch %s → %s', (branch, expected) => {
		expect(taskKeyFromBranch(branch)).toBe(expected);
	});

	it('Issue 番号を含まない branch は null', () => {
		expect(taskKeyFromBranch('develop')).toBeNull();
		expect(taskKeyFromBranch('release/2026-07-27')).toBeNull();
	});
});

describe('agent-lock', () => {
	let dir: string;
	const original = process.env.AGENT_LOCK_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-lock-'));
		process.env.AGENT_LOCK_DIR = dir;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.AGENT_LOCK_DIR;
		else process.env.AGENT_LOCK_DIR = original;
		rmSync(dir, { recursive: true, force: true });
	});

	it('空いていれば取得できる', () => {
		const result = acquire('heavy', { ownerPid: process.pid, target: 'PR #1' });
		expect(result.ok).toBe(true);
		expect(existsSync(lockPath('heavy'))).toBe(true);
		expect(readLock('heavy')?.target).toBe('PR #1');
	});

	it('生きている別セッションが保持していれば取得できない', () => {
		acquire('heavy', { ownerPid: process.pid, target: 'PR #1' });
		// 別セッションを模す: 自分以外の生きた PID として process.ppid を使う
		const other = acquire('heavy', { ownerPid: process.ppid, target: 'PR #2' });
		expect(other.ok).toBe(false);
		expect(other.holder.target).toBe('PR #1');
		// 保持者の記録は上書きされない
		expect(readLock('heavy')?.target).toBe('PR #1');
	});

	it('同じセッションからの再取得は成功する (再入可能)', () => {
		const first = acquire('heavy', { ownerPid: process.pid, now: 1_000 });
		expect(first.ok).toBe(true);
		const second = acquire('heavy', { ownerPid: process.pid, now: 2_000 });
		expect(second.ok).toBe(true);
		expect(readLock('heavy')?.startedAt).toBe(2_000);
	});

	it('保持者プロセスが死んでいれば奪える (セッション断の回収)', () => {
		writeFileSync(
			lockPath('heavy'),
			JSON.stringify({ key: 'heavy', ownerPid: DEAD_PID, startedAt: Date.now() }),
		);
		const result = acquire('heavy', { ownerPid: process.pid });
		expect(result.ok).toBe(true);
		expect(readLock('heavy')?.ownerPid).toBe(process.pid);
	});

	it('TTL を超えていれば奪える', () => {
		const now = 10_000_000;
		writeFileSync(
			lockPath('heavy'),
			JSON.stringify({
				key: 'heavy',
				ownerPid: process.ppid,
				startedAt: now - DEFAULT_TTL_MS - 1,
				ttlMs: DEFAULT_TTL_MS,
			}),
		);
		expect(acquire('heavy', { ownerPid: process.pid, now }).ok).toBe(true);
	});

	it('壊れた lock は stale 扱いにせず例外にする', () => {
		writeFileSync(lockPath('heavy'), '{ not json');
		// 中身が読めない = 排他が成立しているか判定できない。黙って奪うと二重実行になる。
		expect(() => acquire('heavy', { ownerPid: process.pid })).toThrow(/壊れています/);
	});

	it('解放できるのは保持者だけ', () => {
		acquire('heavy', { ownerPid: process.pid });
		expect(release('heavy', process.ppid)).toBe(false);
		expect(existsSync(lockPath('heavy'))).toBe(true);
		expect(release('heavy', process.pid)).toBe(true);
		expect(existsSync(lockPath('heavy'))).toBe(false);
	});

	it('解放後は別セッションが取得できる', () => {
		acquire('heavy', { ownerPid: process.pid });
		release('heavy', process.pid);
		expect(acquire('heavy', { ownerPid: process.ppid }).ok).toBe(true);
	});

	it('task key は Issue ごとに独立する', () => {
		expect(acquire('task-3963', { ownerPid: process.pid }).ok).toBe(true);
		expect(acquire('task-4001', { ownerPid: process.ppid }).ok).toBe(true);
	});

	it('key はファイル名に使えない文字を含んでも安全に落ちる', () => {
		expect(lockPath('task:3963')).toBe(join(dir, 'task-3963.lock'));
		expect(() => lockPath('')).toThrow();
	});

	it('isProcessAlive は自分を生存と判定し、未使用 PID を死亡と判定する', () => {
		expect(isProcessAlive(process.pid)).toBe(true);
		expect(isProcessAlive(DEAD_PID)).toBe(false);
		expect(isProcessAlive(-1)).toBe(false);
	});

	it('isStale は holder が無ければ true', () => {
		expect(isStale(null)).toBe(true);
	});

	it('describeHolder は保持者を 1 行で説明する', () => {
		const text = describeHolder(
			{ ownerPid: 123, startedAt: 1_000, agent: 'GQ-Dev', target: 'PR #3996' },
			61_000,
		);
		expect(text).toContain('pid=123');
		expect(text).toContain('経過=60s');
		expect(text).toContain('GQ-Dev');
		expect(text).toContain('PR #3996');
	});
});

describe('lock ファイルの中身', () => {
	let dir: string;
	const original = process.env.AGENT_LOCK_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-lock-body-'));
		process.env.AGENT_LOCK_DIR = dir;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.AGENT_LOCK_DIR;
		else process.env.AGENT_LOCK_DIR = original;
		rmSync(dir, { recursive: true, force: true });
	});

	it('人間が読める JSON で保持者を記録する', () => {
		acquire('heavy', {
			ownerPid: process.pid,
			agent: 'GQ-Dev',
			target: 'PR #3996',
			sessionId: 'sess-1',
			cwd: 'E:/Github/gq-wt-3996',
		});
		const parsed = JSON.parse(readFileSync(lockPath('heavy'), 'utf8'));
		expect(parsed).toMatchObject({
			key: 'heavy',
			ownerPid: process.pid,
			agent: 'GQ-Dev',
			target: 'PR #3996',
			sessionId: 'sess-1',
		});
		expect(typeof parsed.startedAt).toBe('number');
	});
});
