/**
 * tests/unit/hooks/heavy-run-hooks.test.ts
 *
 * **hook 本体**(`.claude/hooks/heavy-run-lock.mjs` / `heavy-run-unlock.mjs`) を
 * stdin payload つきで実行し、exit code と lock ファイルの結果を固定する。
 *
 * ## なぜ lib 層の test だけでは足りないか (#4094 QA M1 / M4)
 *
 * 既存の `heavy-run-guard.test.ts` は純関数だけを見ており、**hook 層の配線には test が
 * 1 件も無かった**。実際に QA が見つけた 2 件は、どちらも純関数ではなく hook の配線にある:
 *
 * - `heavy-run-unlock.mjs` が `excludePids: []` でマシン全体の heavy を自分の lock に
 *   書き込み、無関係なプロセスのせいで lock が返らなくなる (M1)
 * - `snapshotProcesses()` の失敗が空表になり、実在判定が無警告で消える (M4)
 *
 * どちらも「lib の関数は正しいが、渡している引数が間違っている」class なので、
 * **hook を起動して観測する**層でしか固定できない。
 *
 * ## 決定性の担保
 *
 * プロセス表は `AGENT_PROCESS_TABLE_FILE` (session-owner.mjs のテスト用差し替え口) で
 * 固定する。実プロセス表を使うと、**たまたま走っている別セッションの検証**で結果が
 * 変わる — それ自体が本 PR で直している欠陥なので、test が同じ穴を踏んではいけない。
 * lock 置き場は `AGENT_LOCK_DIR` で temp へ逃がす (実運用中の lock を壊さない)。
 *
 * cspell 例外 (本 file 限定):
 *   - `sess`: session id の fixture 値。global 許可すると `session` の打ち間違いが素通りする
 *   - `pids`: プロセス表の用語。実装の識別子と綴りを揃える
 */
// cspell:ignore sess pids

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LOCK_HOOK = join(REPO_ROOT, '.claude/hooks/heavy-run-lock.mjs');
const UNLOCK_HOOK = join(REPO_ROOT, '.claude/hooks/heavy-run-unlock.mjs');

type ProcRow = { pid: number; ppid: number; name: string; cmd: string };

let dir: string;
let tablePath: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'heavy-run-hooks-'));
	tablePath = join(dir, 'process-table.json');
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** プロセス表を固定する。`null` を渡すと「取得に失敗する」状態を作る。 */
function setProcessTable(rows: ProcRow[] | null) {
	if (rows === null) {
		rmSync(tablePath, { force: true });
		return;
	}
	writeFileSync(tablePath, JSON.stringify(rows));
}

function runHook(hookPath: string, payload: Record<string, unknown>) {
	const r = spawnSync(process.execPath, [hookPath], {
		input: JSON.stringify(payload),
		encoding: 'utf8',
		env: {
			...process.env,
			AGENT_LOCK_DIR: dir,
			AGENT_PROCESS_TABLE_FILE: tablePath,
		},
	});
	return { status: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

function lockFile() {
	return join(dir, 'heavy.lock');
}

function readHeavyLock() {
	if (!existsSync(lockFile())) return null;
	return JSON.parse(readFileSync(lockFile(), 'utf8'));
}

/** hook プロセスの親 = このテストプロセス。祖先鎖に「セッションらしい」行を置く。 */
function sessionRow(pid: number): ProcRow {
	return { pid, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' };
}

describe('heavy-run-lock hook (PreToolUse)', () => {
	it('重い検証でないコマンドは lock を取らずに通す', () => {
		setProcessTable([sessionRow(process.pid)]);
		const r = runHook(LOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'gh pr view 4094 --comments' },
		});
		expect(r.status).toBe(0);
		expect(readHeavyLock()).toBeNull();
	});

	it('重い検証は lock を取って通す', () => {
		setProcessTable([sessionRow(process.pid)]);
		const r = runHook(LOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		expect(r.status).toBe(0);
		expect(readHeavyLock()?.sessionId).toBe('sess-1');
	});

	it('他セッションの検証が実在すれば lock ファイルが無くても BLOCK する (#4083 AC2)', () => {
		setProcessTable([
			sessionRow(process.pid),
			{ pid: 990001, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4081' },
		]);
		const r = runHook(LOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npx vitest run tests/unit/hooks/heavy-run-guard.test.ts' },
		});
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('実際に走っています');
		// **案内どおりに操作して解除できること** (#4094 QA M3)。
		// `--kill` 単独は unowned を落とさないので、起点 PID つきの手順を出す。
		expect(r.stderr).toContain('--pid 990001');
	});

	it('プロセス表を取得できないとき、実在判定を行っていないことを必ず出す (#4094 QA M4)', () => {
		setProcessTable(null); // AGENT_PROCESS_TABLE_FILE は指すが読めない = 取得失敗
		const r = runHook(LOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		// 素通り (silent fail-open) させない。警告を出したうえで lock 経路に倒す。
		expect(r.stderr).toContain('プロセス表を取得できませんでした');
		expect(r.stderr).toContain('実在ベースの並走判定を行っていません');
	});

	it('一括 kill は lock とは別軸で BLOCK する (#4069 AC4)', () => {
		setProcessTable([sessionRow(process.pid)]);
		const r = runHook(LOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'Get-Process node | Stop-Process -Force' },
		});
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('一括停止');
	});

	it('入力 JSON が壊れていたら素通しせず BLOCK する (fail closed)', () => {
		setProcessTable([sessionRow(process.pid)]);
		const r = spawnSync(process.execPath, [LOCK_HOOK], {
			input: '{ not json',
			encoding: 'utf8',
			env: { ...process.env, AGENT_LOCK_DIR: dir, AGENT_PROCESS_TABLE_FILE: tablePath },
		});
		expect(r.status).toBe(2);
	});
});

describe('heavy-run-unlock hook (PostToolUse)', () => {
	/** lock を 1 本置く (PreToolUse 相当)。 */
	function seedLock(guardedPids: number[] | null = null) {
		writeFileSync(
			lockFile(),
			JSON.stringify({
				key: 'heavy',
				ownerPid: process.pid,
				guardedPids,
				sessionId: 'sess-1',
				startedAt: Date.now(),
				ttlMs: 60 * 60 * 1000,
			}),
		);
	}

	it('自分の検証が終わっていれば lock を返す', () => {
		seedLock();
		setProcessTable([sessionRow(process.pid)]);
		const r = runHook(UNLOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		expect(r.status).toBe(0);
		expect(readHeavyLock()).toBeNull();
	});

	it('無関係な他セッションの検証を自分の lock に書き込まない (#4094 QA M1)', () => {
		seedLock();
		setProcessTable([
			sessionRow(process.pid),
			// 別クローンの QA セッション / hook 未登録の Buzz セッション / 人間の watch。
			// いずれも**この lock の保護対象ではない**。
			{ pid: 990002, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4063' },
			{
				pid: 990003,
				ppid: 1,
				name: 'node.exe',
				cmd: 'node node_modules/vitest/vitest.mjs --watch',
			},
		]);
		const r = runHook(UNLOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		expect(r.status).toBe(0);
		// 旧実装はここで lock が残り、`isStale` が guarded 生存を TTL より優先するため
		// **誰も奪えない**状態になっていた。
		expect(readHeavyLock()).toBeNull();
	});

	it('自分の系列の検証が走っている間は lock を返さない (#4083 AC1、弱めない)', () => {
		seedLock();
		// このテストプロセス自身を「自分の系列で走っている検証」に見立てる
		// (`process.kill(pid, 0)` が通る = 実在する PID である必要があるため)。
		setProcessTable([
			sessionRow(990004),
			{
				pid: process.pid,
				ppid: 990004,
				name: 'node.exe',
				cmd: 'node scripts/pre-ready.mjs --pr 4094',
			},
		]);
		const r = runHook(UNLOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		expect(r.status).toBe(0);
		expect(readHeavyLock()?.guardedPids).toContain(process.pid);
	});

	it('プロセス表を取得できないときは警告を出す (#4094 QA M4)', () => {
		seedLock();
		setProcessTable(null);
		const r = runHook(UNLOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'npm run pre-ready -- --pr 4094' },
		});
		expect(r.status).toBe(0);
		expect(r.stderr).toContain('プロセス表を取得できませんでした');
	});

	it('重い検証でないコマンドでは何もしない', () => {
		seedLock();
		setProcessTable([sessionRow(process.pid)]);
		const r = runHook(UNLOCK_HOOK, {
			session_id: 'sess-1',
			tool_input: { command: 'gh pr view 4094' },
		});
		expect(r.status).toBe(0);
		expect(readHeavyLock()).not.toBeNull();
	});
});
