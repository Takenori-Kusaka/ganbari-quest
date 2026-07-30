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
 * cspell 例外 (本 file 限定、`.cspell.json` の global words には足さない):
 *   - `sess`: session id の fixture 値 (`sess-1`)。global 許可すると `session` の打ち間違いが素通りする
 *   - `cmdline` / `pids`: プロセス表の用語。実装 (`heavy-process.mjs`) の識別子と綴りを揃える必要がある
 *   - `killall` / `gps` / `wmic` / `xargs` / `ef`: 実在のコマンド名・オプション。一括 kill の
 *     負例 / 正例 fixture なので、綴りを直すと検出対象でなくなる
 */
// cspell:ignore sess cmdline pids killall gps wmic xargs ef

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
	resolveCommandCwdEvidence,
	resolvePushRefBranch,
} from '../../../scripts/lib/agent-lock-policy.mjs';
import {
	buildGuardedPids,
	collectDescendants,
	createHeavyPidVerifier,
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

	it.each([
		// パッケージマネージャ直下の bin 実行形。旧実装 (正規表現の部分一致) は止めていた
		// ので、構造判定への移行でここが抜けると **ガードが正味で弱くなる** (ADR-0006)。
		'yarn vitest',
		'pnpm vitest run',
		'bun vitest run',
		// 値を取るフラグを挟む形。値をサブコマンドとして読むと素通りする。
		'npm --prefix . run pre-ready',
		'pnpm --filter app run test',
		// スクリプト実体を直接叩く形。
		'node --experimental-vm-modules node_modules/vitest/vitest.mjs run',
	])('AC2: 旧実装が止めていた形を引き続き止める (ADR-0006): %s', (command) => {
		expect(isHeavyCommand(command)).toBe(true);
	});

	it('AC2: 起動判定と走行中判定の包含関係 (起動を許したものが走行中に全 BLOCK を招かない)', () => {
		// 起動を許可したのに、走り出したら `heavy-process.mjs` に重い検証として検出され、
		// 他セッション全部を BLOCK する — という非対称を作らない (#4094 QM 指摘 1)。
		// 実際に起動されるプロセスの cmdline を左、hook が見るコマンド文字列を右に置く。
		const pairs: [launchCommand: string, processCmdline: string][] = [
			['yarn vitest', 'node node_modules/vitest/vitest.mjs'],
			['pnpm vitest run', 'node node_modules/vitest/vitest.mjs run'],
			[
				'node --experimental-vm-modules node_modules/vitest/vitest.mjs run',
				'node --experimental-vm-modules node_modules/vitest/vitest.mjs run',
			],
			['npm --prefix . run pre-ready', 'node scripts/pre-ready.mjs'],
			['npx playwright test', 'node node_modules/playwright/cli.js test'],
		];
		for (const [launchCommand, processCmdline] of pairs) {
			if (!isHeavyProcessCmdline(processCmdline)) continue;
			expect(
				isHeavyCommand(launchCommand),
				`${launchCommand} は走行中に heavy と検出されるので起動時も止めるべき`,
			).toBe(true);
		}
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
			resolvePushRefBranch(
				'git push --force-with-lease origin fix/3980-3981-stripe-plan-resolution',
			),
		).toBe('fix/3980-3981-stripe-plan-resolution');
		expect(
			resolvePushRefBranch('git push origin HEAD:refs/heads/fix/4017-dependency-review-waiver'),
		).toBe('fix/4017-dependency-review-waiver');
	});

	it('AC1: refspec が無ければ null (cwd 解決にフォールバックする)', () => {
		expect(resolvePushRefBranch('git push')).toBeNull();
		expect(resolvePushRefBranch('git push -u origin HEAD')).toBeNull();
		expect(resolvePushRefBranch('git status')).toBeNull();
	});

	it('AC2: cwd は「コマンドが実行される場所」から解決する', () => {
		// 実測はメインクローン `E:\Github\ganbari-quest-dev` だが、期待値は
		// `resolve` で組む — Windows パスを Linux CI (絶対パスと見なされない) で
		// `join` 比較すると cwd が前置されて落ちる。ここで固定したい不変条件は
		// 「**基準ディレクトリからの相対解決**であって payload cwd のままではない」
		// ことなので、プラットフォーム非依存に書く。
		const main = 'E:\\Github\\ganbari-quest-dev';
		const worktree = resolve(main, '.claude/worktrees/agent-a1ef5ad9e76bd9d2f');

		// worktree へ cd してから push する形
		const afterCd = resolveCommandCwd(
			'cd .claude/worktrees/agent-a1ef5ad9e76bd9d2f && git push origin HEAD',
			main,
		);
		expect(afterCd).toBe(worktree);
		expect(afterCd).not.toBe(main); // payload cwd のまま返していないこと (#4076 の核)

		// git -C 指定
		const afterDashC = resolveCommandCwd(
			'git -C .claude/worktrees/agent-a1ef5ad9e76bd9d2f push origin HEAD',
			main,
		);
		expect(afterDashC).toBe(worktree);
		expect(afterDashC).not.toBe(main);

		// 手がかりが無ければ hook payload の cwd
		expect(resolveCommandCwd('git push origin HEAD', main)).toBe(main);
	});

	it('AC1: 値を取るフラグの値を refspec と読み違えない (#4094 QA I2)', () => {
		// `-o ci.skip` の値を operand に混ぜると refspec の位置がずれ、branch を
		// `origin` と解釈して**無関係な lock を掴む**方向に誤爆する。
		expect(resolvePushRefBranch('git push -o ci.skip origin fix/4083-lock')).toBe('fix/4083-lock');
		expect(resolvePushRefBranch('git push --repo git@example.com:x.git origin fix/4083-lock')).toBe(
			'fix/4083-lock',
		);
		expect(resolvePushRefBranch('git push --push-option=ci.skip origin fix/4083-lock')).toBe(
			'fix/4083-lock',
		);
		// 値を取らないフラグを「値を食う」側に入れてしまうと、効いている判定が壊れる。
		expect(resolvePushRefBranch('git push --force-with-lease origin fix/4083-lock')).toBe(
			'fix/4083-lock',
		);
	});

	it('AC2: cmd.exe の `cd /d` をディレクトリと読まない (#4094 QA I3)', () => {
		const main = 'E:\\Github\\ganbari-quest-dev';
		const worktree = resolve(main, '.claude/worktrees/agent-a216f1fd6f7cff174');
		const cwd = resolveCommandCwd(
			'cd /d .claude/worktrees/agent-a216f1fd6f7cff174 && git push origin HEAD',
			main,
		);
		expect(cwd).toBe(worktree);
		expect(cwd).not.toBe(resolve(main, '/d'));
	});

	it('AC2: 実行先の根拠がコマンドに無ければ「解決した」と言わない (#4094 QA I1)', () => {
		const main = 'E:\\Github\\ganbari-quest-dev';
		// cd / -C がある = コマンド自身が実行先を示している
		expect(resolveCommandCwdEvidence('cd sub && git push', main).fromCommand).toBe(true);
		expect(resolveCommandCwdEvidence('git -C sub push', main).fromCommand).toBe(true);
		// 単独 push はセッション cwd を返すだけ。**branch 判定の入力にしてはいけない**
		// (Bash tool の cwd は前の呼び出しの cd を引き継ぐが payload の cwd は引き継がない)
		const bare = resolveCommandCwdEvidence('git push', main);
		expect(bare.fromCommand).toBe(false);
		expect(bare.cwd).toBe(main);
		expect(resolveCommandCwdEvidence('git push -u origin HEAD', main).fromCommand).toBe(false);
	});

	it('AC3: 同一ブランチの二重作業は引き続き検出できる (ガードを弱めない)', () => {
		// メインクローン = fix/4017 / worktree = fix/3980 の実測構成。
		// worktree からの push は自分のブランチで判定され、
		// 同じ fix/4017 を押す 2 本目は同じ key に落ちる。
		const worktreePush = resolvePushRefBranch(
			'git push origin fix/3980-3981-stripe-plan-resolution',
		);
		const mainPush = resolvePushRefBranch('git push origin fix/4017-dependency-review-waiver');
		expect(worktreePush).not.toBe(mainPush);
		expect(
			resolvePushRefBranch('git push --force-with-lease origin fix/4017-dependency-review-waiver'),
		).toBe(mainPush);
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

	it('AC1: 所有者を辿れない残骸は kill 対象にせず、しかし必ず可視化する', () => {
		// 実測: ハーネス起動の検証チェーンはセッションの子孫から外れることがある
		// (本 PR 作業中に pre-ready の親が session owner ではなかった)。
		// ここで報告しないと「残骸なし」と読んで全 kill に手が伸びる (#4069 の再発)。
		const detached = makeTable([
			{ pid: 100, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
			{ pid: 900, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4094' },
		]);
		const plan = planProcessCleanup({ table: detached, ownerPid: 100, protectedPids: [] });
		expect(plan.targets).toEqual([]);
		expect(plan.unowned.map((p) => p.pid)).toEqual([900]);
	});

	it('AC2: lock 保持者は unowned にも出さない (他者の実行中を掃除候補に見せない)', () => {
		const plan = planProcessCleanup({ table, ownerPid: 100, protectedPids: [210] });
		expect(plan.unowned.map((p) => p.pid)).toEqual([]);
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
		'node scripts/agent-cleanup.mjs --pid 33176 --kill',
		// 列挙だけ / 停止を伴わない pipeline は無害なので通す (誤爆させない)
		'Get-Process node | Select-Object Id,Path',
	])('AC4: PID 指定の停止は通す (掃除手段を潰さない): %s', (command) => {
		expect(isBulkProcessKillCommand(command)).toBe(false);
	});

	it.each([
		// この環境で最も自然に書かれる形。matcher は `Bash|PowerShell` なので実際に到達する。
		'Get-Process node | Stop-Process -Force',
		'Get-Process -Name node | Stop-Process',
		'gps node | kill',
		'ps -ef | grep node | xargs kill -9',
		// 引用するだけの回避
		'taskkill /F /IM "node.exe"',
		"killall 'node'",
		"wmic process where name='node.exe' delete",
	])('AC4: 一括 kill は書き方を変えても検出する (#4094 QM 指摘 2): %s', (command) => {
		expect(isBulkProcessKillCommand(command)).toBe(true);
	});

	it('AC4: 一括 kill コマンドへの「言及」は BLOCK しない (#4071 と同じ原則)', () => {
		expect(
			isBulkProcessKillCommand(
				'gh issue create --title "taskkill /F /IM node.exe が他セッションを止めた" --body-file tmp/i.md',
			),
		).toBe(false);
	});

	it('M3: --pid で指定した起点 PID 自身も掃除対象になる (BLOCK の出口が機能する)', () => {
		// #4083 のオーファン: 起動元セッションが死に、誰の子孫でもない残骸。
		// `collectDescendants` は起点自身を含まないため、doc が案内する
		// `--pid <そのpid>` でも落とせない = 「BLOCK されるが解除できない」状態だった。
		const orphaned = makeTable([
			{ pid: 900, ppid: 1, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4094' },
			{ pid: 901, ppid: 900, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs run' },
		]);
		const plan = planProcessCleanup({ table: orphaned, ownerPid: 900, protectedPids: [] });
		expect(plan.targets.map((p) => p.pid)).toEqual([900, 901]);
	});

	it('M3: 起点がセッションプロセスなら自分自身は落とさない', () => {
		// 自動解決された起点は claude / acp の node であり cmdline が重い検証に
		// 一致しないので、上の変更で自分のセッションが対象に入ることはない。
		const table = makeTable([
			{ pid: 100, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
			{ pid: 120, ppid: 100, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4081' },
		]);
		const plan = planProcessCleanup({ table, ownerPid: 100, protectedPids: [] });
		expect(plan.targets.map((p) => p.pid)).toEqual([120]);
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

	it('M1: 保護対象は自セッションの系列に限る (無関係な heavy を自分の lock に書かない)', () => {
		// 実測構成: 自分のセッション (100) の下で pre-ready が走っており、同じマシンで
		// 別クローンの QA セッション (200) と、hook を読み込まない Buzz セッション (300)、
		// 人間の watch (400) が動いている。
		const table = makeTable([
			{ pid: 100, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
			{ pid: 110, ppid: 100, name: 'bash.exe', cmd: 'bash -c ...' },
			{ pid: 120, ppid: 110, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4094' },
			{ pid: 200, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
			{ pid: 210, ppid: 200, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4063' },
			{ pid: 300, ppid: 1, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs run' },
			{ pid: 400, ppid: 1, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs --watch' },
		]);
		expect(buildGuardedPids({ table, ownerPid: 100 })).toEqual([120]);
		// 他人の PID を 1 つでも書き込むと、`isStale` が guarded 生存を TTL より
		// 優先するせいで**誰も奪えない**状態になる (#4094 QA M1)。
		expect(buildGuardedPids({ table, ownerPid: 100 })).not.toContain(210);
		expect(buildGuardedPids({ table, ownerPid: 100 })).not.toContain(300);
		expect(buildGuardedPids({ table, ownerPid: 100 })).not.toContain(400);
		// 持ち主を解決できなければ保護対象は空 (誰も保護しない = 通常解放)
		expect(buildGuardedPids({ table, ownerPid: null })).toEqual([]);
	});

	it('M1: 自分の系列の heavy は引き続き保護する (ガードを弱めない)', () => {
		const table = makeTable([
			{ pid: 100, ppid: 1, name: 'node.exe', cmd: 'node @agentclientprotocol/claude-agent-acp' },
			{ pid: 120, ppid: 100, name: 'node.exe', cmd: 'node scripts/pre-ready.mjs --pr 4094' },
			{ pid: 121, ppid: 120, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs run' },
			// detach されて子孫から外れた自分の残骸は、呼び出し側が明示したときだけ入る
			{ pid: 130, ppid: 1, name: 'node.exe', cmd: 'node node_modules/vitest/vitest.mjs run' },
		]);
		expect(buildGuardedPids({ table, ownerPid: 100 })).toEqual([120, 121]);
		expect(buildGuardedPids({ table, ownerPid: 100, extraRootPids: [130] })).toEqual([
			120, 121, 130,
		]);
	});

	it('M2: PID 再利用で恒久 BLOCK にならない (生存 + 今も重い検証、を要求する)', () => {
		// `guardedPids` に記録された PID が別プロセスに再割当されたケース。
		// 生存確認だけだと TTL も ownerPid 死亡もバイパスされ、lock が二度と stale に
		// ならない (Windows は PID 再利用が速い)。
		const table = makeTable([
			{ pid: process.pid, ppid: 1, name: 'explorer.exe', cmd: 'C:\\Windows\\explorer.exe' },
		]);
		const verifier = createHeavyPidVerifier(table, () => true);
		const holder = {
			key: 'heavy',
			ownerPid: DEAD_PID,
			guardedPids: [process.pid],
			startedAt: Date.now() - 5 * 60 * 60 * 1000,
			ttlMs: 60 * 60 * 1000,
		};
		// 検証なし = 生きているだけで保護され続ける (旧挙動)
		expect(isStale(holder, Date.now())).toBe(false);
		// 検証あり = 重い検証ではないので保護されず、TTL / ownerPid 死亡で奪える
		expect(isStale(holder, Date.now(), { isGuardedPidAlive: verifier })).toBe(true);
	});

	it('M2: 本当に重い検証が走っている間は、検証を強めても奪えない (ガードを弱めない)', () => {
		const table = makeTable([
			{
				pid: process.pid,
				ppid: 1,
				name: 'node.exe',
				cmd: 'node scripts/pre-ready.mjs --pr 4094',
			},
		]);
		const verifier = createHeavyPidVerifier(table, () => true);
		const holder = {
			key: 'heavy',
			ownerPid: DEAD_PID,
			guardedPids: [process.pid],
			startedAt: Date.now() - 5 * 60 * 60 * 1000,
			ttlMs: 60 * 60 * 1000,
		};
		expect(isStale(holder, Date.now(), { isGuardedPidAlive: verifier })).toBe(false);
		// プロセス表に無い PID は「消えた」と断定できないので保護側に倒す
		const unknown = createHeavyPidVerifier(makeTable([]), () => true);
		expect(isStale(holder, Date.now(), { isGuardedPidAlive: unknown })).toBe(false);
	});

	it('M2: 検証つきで奪える lock は acquire でも奪える (経路が一致する)', () => {
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
		const table = makeTable([
			{ pid: process.pid, ppid: 1, name: 'explorer.exe', cmd: 'C:\\Windows\\explorer.exe' },
		]);
		const result = acquire('heavy', {
			sessionId: 'sess-other',
			now,
			isGuardedPidAlive: createHeavyPidVerifier(table, () => true),
		});
		expect(result.ok).toBe(true);
		expect(readLock('heavy')?.sessionId).toBe('sess-other');
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
