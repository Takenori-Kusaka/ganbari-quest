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
 *
 * cspell 例外 (本 file 限定、.cspell.json への global 追加はしない):
 *   - `pushx`: 「`push` で始まるが push ではない」負例 fixture。前方一致で判定していたら
 *     通ってしまう形を実名で置いている (dev-session §QA 指摘台帳 観点 2 の prefix 一致問題)。
 *     綴りを直すと fixture の意味が失われるため、語そのものを残す
 *   - `sess`: session id の fixture 値 (`sess-1`)
 *   global 辞書に足すと `sess` の打ち間違いが repo 全体で素通りするため、file scope に閉じる。
 */
// cspell:ignore pushx sess

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
	sameOwner,
} from '../../../scripts/lib/agent-lock.mjs';
import {
	extractTarget,
	isBranchPublishCommand,
	isHeavyCommand,
	taskKeyFromBranch,
} from '../../../scripts/lib/agent-lock-policy.mjs';
import { resolveSessionOwner } from '../../../scripts/lib/session-owner.mjs';

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
		expect(other.holder?.target).toBe('PR #1');
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

	it('持ち主 PID をどう決めたかを記録する (実環境で解決に失敗していないか後から見えるように)', () => {
		acquire('heavy', { sessionId: 'sess-1', ownerPid: process.pid, ownerVia: 'ancestor' });
		expect(readLock('heavy')?.ownerVia).toBe('ancestor');
	});
});

/**
 * #4013 の回帰テスト。
 *
 * 実測 (2026-07-27): 同一セッションの hook 呼び出しが毎回別の `process.ppid` を持ち、
 * 1 分以内に全て死亡していた。PID を同一性にも生存判定にも使っていたため、
 * 再入・解放・stale 判定の 3 つが同時に壊れ、排他が成立していなかった。
 */
describe('#4013 持ち主の同一性は sessionId で持つ', () => {
	let dir: string;
	const original = process.env.AGENT_LOCK_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-lock-4013-'));
		process.env.AGENT_LOCK_DIR = dir;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.AGENT_LOCK_DIR;
		else process.env.AGENT_LOCK_DIR = original;
		rmSync(dir, { recursive: true, force: true });
	});

	it('sameOwner は sessionId を優先し、片方だけ持つ場合は別物と判定する', () => {
		expect(sameOwner({ sessionId: 'a', ownerPid: 1 }, { sessionId: 'a', ownerPid: 2 })).toBe(true);
		expect(sameOwner({ sessionId: 'a', ownerPid: 1 }, { sessionId: 'b', ownerPid: 1 })).toBe(false);
		// PID が偶然一致しただけで再入とみなすと、他セッションの lock を奪ってしまう。
		expect(sameOwner({ sessionId: 'a', ownerPid: 1 }, { sessionId: null, ownerPid: 1 })).toBe(
			false,
		);
		expect(sameOwner({ sessionId: null, ownerPid: 1 }, { sessionId: null, ownerPid: 1 })).toBe(
			true,
		);
		expect(sameOwner(null, { sessionId: 'a' })).toBe(false);
	});

	it('同じセッションなら ownerPid が変わっても再入できる (呼び出しごとに PID が変わる実環境)', () => {
		const first = acquire('heavy', { sessionId: 'session-a', ownerPid: process.pid, now: 1_000 });
		expect(first.ok).toBe(true);
		// 次の hook 呼び出しでは別の (しかも既に死んでいる) PID になる。
		const second = acquire('heavy', { sessionId: 'session-a', ownerPid: process.ppid, now: 2_000 });
		expect(second.ok).toBe(true);
		expect(readLock('heavy')?.startedAt).toBe(2_000);
	});

	it('別セッションなら ownerPid が同じでも取得できない', () => {
		acquire('heavy', { sessionId: 'session-a', ownerPid: process.pid, target: 'PR #1' });
		const other = acquire('heavy', {
			sessionId: 'session-b',
			ownerPid: process.pid,
			target: 'PR #2',
		});
		expect(other.ok).toBe(false);
		expect(other.holder.target).toBe('PR #1');
	});

	it('取得時と解放時で PID が変わっても解放できる (解放が no-op にならない)', () => {
		acquire('heavy', { sessionId: 'session-a', ownerPid: process.pid });
		expect(release('heavy', { sessionId: 'session-a', ownerPid: DEAD_PID })).toBe(true);
		expect(existsSync(lockPath('heavy'))).toBe(false);
	});

	it('別セッションは解放できない', () => {
		acquire('heavy', { sessionId: 'session-a', ownerPid: process.pid });
		expect(release('heavy', { sessionId: 'session-b', ownerPid: process.pid })).toBe(false);
		expect(existsSync(lockPath('heavy'))).toBe(true);
	});

	it('ownerPid が無い lock は生存判定せず TTL のみで判定する', () => {
		const now = 10_000_000;
		const holder = {
			ownerPid: null,
			sessionId: 'session-a',
			startedAt: now,
			ttlMs: DEFAULT_TTL_MS,
		};
		// PID が無いことを「死んでいる」と読むと、生きているセッションの lock を全員が奪える。
		expect(isStale(holder, now + 1_000)).toBe(false);
		expect(isStale(holder, now + DEFAULT_TTL_MS + 1)).toBe(true);
	});

	it('ownerPid が解決できなくても sessionId だけで取得・排他・解放できる', () => {
		expect(acquire('heavy', { sessionId: 'session-a', ownerPid: null, now: 1_000 }).ok).toBe(true);
		expect(acquire('heavy', { sessionId: 'session-b', ownerPid: null, now: 1_100 }).ok).toBe(false);
		expect(release('heavy', { sessionId: 'session-a' })).toBe(true);
		expect(acquire('heavy', { sessionId: 'session-b', ownerPid: null, now: 1_200 }).ok).toBe(true);
	});

	it('sessionId も ownerPid も無い取得は例外にする (持ち主を識別できない)', () => {
		expect(() => acquire('heavy', { sessionId: null, ownerPid: null })).toThrow(/識別できません/);
	});

	it('不正な ownerPid は黙って無視せず例外にする', () => {
		expect(() => acquire('heavy', { sessionId: 'session-a', ownerPid: -1 })).toThrow(/ownerPid/);
	});

	it('describeHolder は PID 不明の lock をそう表示する', () => {
		const text = describeHolder({ ownerPid: null, sessionId: 'session-a', startedAt: 0 }, 1_000);
		expect(text).toContain('pid=不明');
		expect(text).toContain('session-a');
	});
});

/**
 * 実測したプロセスツリー (2026-07-27, Windows / Buzz) を再現した table で固定する。
 *
 *   buzz-acp.exe(30980) → buzz-acp.exe(33476) → cmd.exe(25916)
 *     → node.exe claude-agent-acp(7840) → claude.exe(28348) → bash(6492) → node hook(26100)
 */
describe('#4013 resolveSessionOwner', () => {
	const table = new Map<number, { pid: number; ppid: number; name: string; cmd: string }>([
		[26100, { pid: 26100, ppid: 6492, name: 'node.exe', cmd: 'node hook.mjs' }],
		[6492, { pid: 6492, ppid: 28348, name: 'bash.exe', cmd: 'bash -c ...' }],
		[28348, { pid: 28348, ppid: 7840, name: 'claude.exe', cmd: 'claude.exe --output-format' }],
		[
			7840,
			{
				pid: 7840,
				ppid: 25916,
				name: 'node.exe',
				cmd: 'node @agentclientprotocol/claude-agent-acp/dist/index.js',
			},
		],
		// 実測の CommandLine をそのまま入れる。acp 名を含むため、シェル除外が無いと
		// 「最も外側のセッションらしいプロセス」としてこの cmd.exe が選ばれてしまう。
		[
			25916,
			{
				pid: 25916,
				ppid: 33476,
				name: 'cmd.exe',
				cmd: 'cmd.exe /e:ON /v:OFF /d /c ""C:\\Users\\kokor\\AppData\\Roaming\\npm\\claude-agent-acp.cmd""',
			},
		],
		[33476, { pid: 33476, ppid: 30980, name: 'buzz-acp.exe', cmd: 'buzz-acp.exe' }],
		[30980, { pid: 30980, ppid: 1, name: 'buzz-acp.exe', cmd: 'buzz-acp.exe' }],
	]);

	it('共有境界の手前で最も外側のセッションプロセスを選ぶ', () => {
		const owner = resolveSessionOwner(6492, table);
		// claude.exe (28348) はセッションごとに複数生まれるため持ち主にしない。
		// acp の node (7840) はセッション開始時に 1 個だけ作られ常駐する。
		expect(owner.pid).toBe(7840);
		expect(owner.via).toBe('ancestor');
	});

	it('全セッション共有の buzz-acp を持ち主にしない (掴むと排他が消える)', () => {
		const owner = resolveSessionOwner(6492, table);
		expect(owner.pid).not.toBe(30980);
		expect(owner.pid).not.toBe(33476);
		expect(owner.chain).not.toContain(30980);
	});

	it('acp を起動したシェル (cmd.exe) を持ち主にしない', () => {
		// cmd.exe(25916) の CommandLine は実測で `claude-agent-acp.cmd` を含み、
		// node(7840) より外側にある。シェル除外が無いとこちらが選ばれる。
		const owner = resolveSessionOwner(6492, table);
		expect(owner.pid).not.toBe(25916);
		expect(owner.name).toBe('node.exe');
	});

	it('セッションらしい祖先が無ければ null を返す (ppid へ黙って戻さない)', () => {
		const shellOnly = new Map([
			[10, { pid: 10, ppid: 11, name: 'node.exe', cmd: 'node hook.mjs' }],
			[11, { pid: 11, ppid: 1, name: 'bash.exe', cmd: 'bash' }],
		]);
		const owner = resolveSessionOwner(10, shellOnly);
		expect(owner.pid).toBeNull();
		expect(owner.via).toBe('not-found');
	});

	it('プロセス一覧が取れなければ no-process-table を返す', () => {
		expect(resolveSessionOwner(1, new Map()).via).toBe('no-process-table');
	});

	it('親子関係が循環していても無限ループしない', () => {
		const loop = new Map([
			[1, { pid: 1, ppid: 2, name: 'a', cmd: 'a' }],
			[2, { pid: 2, ppid: 1, name: 'b', cmd: 'b' }],
		]);
		expect(resolveSessionOwner(1, loop).pid).toBeNull();
	});
});

/**
 * #4013 / QM 申し送り 1: `readLock` の JSDoc cast は runtime validation ではない。
 *
 * lock file は `~/.buzz/.locks/` にあり同一マシンの任意プロセスが書ける。壊れた値の
 * 落とし先はフィールドごとに違い、**「奪う方向」に倒れないこと**が本 describe の主題。
 */
describe('#4013 readLock は lock レコードのフィールドを検証する', () => {
	let dir: string;
	const original = process.env.AGENT_LOCK_DIR;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'agent-lock-validate-'));
		process.env.AGENT_LOCK_DIR = dir;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.AGENT_LOCK_DIR;
		else process.env.AGENT_LOCK_DIR = original;
		rmSync(dir, { recursive: true, force: true });
	});

	/** 壊れた lock を直接置く (本 module 以外の書き手を模す)。 */
	function writeRawLock(record: Record<string, unknown>): void {
		writeFileSync(lockPath('heavy'), `${JSON.stringify(record)}\n`);
	}

	it('ownerPid が数値でなければ null に落ちる (「死んでいる」と読まない)', () => {
		writeRawLock({ key: 'heavy', ownerPid: 'not-a-pid', sessionId: 'session-a', startedAt: 0 });
		expect(readLock('heavy')?.ownerPid).toBeNull();
	});

	it('ownerPid が壊れた lock は TTL 内なら奪えない', () => {
		const now = 10_000_000;
		writeRawLock({
			key: 'heavy',
			ownerPid: 'not-a-pid',
			sessionId: 'session-a',
			startedAt: now,
			ttlMs: DEFAULT_TTL_MS,
		});
		// 修正前は isProcessAlive('not-a-pid') === false → stale 扱いで奪えていた。
		// 「持ち主が誰か分からない」を「持ち主が死んでいる」と読むと排他が消える。
		const result = acquire('heavy', { sessionId: 'session-b', now: now + 1_000 });
		expect(result.ok).toBe(false);
		expect(result.holder?.sessionId).toBe('session-a');
	});

	it('ownerPid が壊れた lock も TTL を超えれば奪える (永久ブロックにしない)', () => {
		const now = 10_000_000;
		writeRawLock({
			key: 'heavy',
			ownerPid: 'not-a-pid',
			sessionId: 'session-a',
			startedAt: now,
			ttlMs: DEFAULT_TTL_MS,
		});
		const result = acquire('heavy', { sessionId: 'session-b', now: now + DEFAULT_TTL_MS + 1 });
		expect(result.ok).toBe(true);
	});

	it('ownerPid が 0 / 負数 / 小数なら null に落ちる', () => {
		for (const bad of [0, -1, 3.5]) {
			writeRawLock({ key: 'heavy', ownerPid: bad, sessionId: 'session-a', startedAt: 0 });
			expect(readLock('heavy')?.ownerPid).toBeNull();
		}
	});

	it('startedAt が数値でなければ例外にする (TTL 判定の基準を失った lock を奪わせない)', () => {
		writeRawLock({ key: 'heavy', ownerPid: process.pid, sessionId: 'session-a', startedAt: 'x' });
		expect(() => readLock('heavy')).toThrow(/startedAt/);
	});

	it('startedAt が欠落していても例外にする', () => {
		writeRawLock({ key: 'heavy', ownerPid: process.pid, sessionId: 'session-a' });
		expect(() => readLock('heavy')).toThrow(/startedAt/);
	});

	it('ttlMs が壊れていれば DEFAULT_TTL_MS で判定する', () => {
		const now = 10_000_000;
		writeRawLock({
			key: 'heavy',
			ownerPid: null,
			sessionId: 'session-a',
			startedAt: now,
			ttlMs: 'x',
		});
		expect(readLock('heavy')?.ttlMs).toBe(DEFAULT_TTL_MS);
		expect(isStale(readLock('heavy'), now + DEFAULT_TTL_MS - 1)).toBe(false);
		expect(isStale(readLock('heavy'), now + DEFAULT_TTL_MS + 1)).toBe(true);
	});

	it('sessionId が文字列でなければ null に落ち、同一性が成立しない', () => {
		const now = 10_000_000;
		writeRawLock({ key: 'heavy', ownerPid: null, sessionId: { a: 1 }, startedAt: now });
		const holder = readLock('heavy');
		expect(holder?.sessionId).toBeNull();
		// 同一性が取れない lock は再入も解放もできず、TTL 満了まで誰も取れない (fail closed)。
		expect(sameOwner(holder, { sessionId: 'session-a', ownerPid: null })).toBe(false);
		expect(release('heavy', { sessionId: 'session-a', ownerPid: null })).toBe(false);
	});

	it('chain は正常なら保持される (ownerVia と対で証跡になる)', () => {
		acquire('heavy', {
			sessionId: 'session-a',
			ownerPid: process.pid,
			ownerVia: 'ancestor',
			ownerChain: [26100, 6492, 28348, 7840],
		});
		expect(readLock('heavy')?.chain).toEqual([26100, 6492, 28348, 7840]);
		expect(readLock('heavy')?.ownerVia).toBe('ancestor');
	});

	it('chain は 1 要素でも不正なら配列ごと null にする (半分正しい証跡を作らない)', () => {
		writeRawLock({
			key: 'heavy',
			ownerPid: null,
			sessionId: 'session-a',
			startedAt: 0,
			chain: [26100, 'x', 7840],
		});
		expect(readLock('heavy')?.chain).toBeNull();
	});

	it('chain が配列でなければ null にする', () => {
		writeRawLock({
			key: 'heavy',
			ownerPid: null,
			sessionId: 'session-a',
			startedAt: 0,
			chain: 7840,
		});
		expect(readLock('heavy')?.chain).toBeNull();
	});

	it('JSON として object でなければ従来どおり例外にする', () => {
		writeFileSync(lockPath('heavy'), '"just a string"\n');
		expect(() => readLock('heavy')).toThrow(/壊れています/);
	});
});
