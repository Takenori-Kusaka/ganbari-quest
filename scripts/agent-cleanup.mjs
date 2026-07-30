#!/usr/bin/env node

/**
 * scripts/agent-cleanup.mjs — 中断後の検証プロセスを**所有権単位**で片付ける (Issue #4069)。
 *
 * ## なぜ必要か
 *
 * 中断でゾンビが残ったとき、これまで手段は `taskkill /F /IM node.exe` (全 node kill) しか
 * なかった。2026-07-29 の夜間ランでは、それが lock を正当に保持して検証中だった別セッション
 * (PR #4063) まで巻き込んで停止させた。**排他は「開始を止める」だけを設計対象にしており、
 * 「異常終了後の後始末」が未定義**だったのが原因である。
 *
 * 本 CLI は 2 つの原則で掃除する:
 *
 * 1. **対象は自分の子孫だけ** — 他セッションのプロセスは候補にすら入れない
 * 2. **lock 保持者とその子孫は除外** — 自分の子孫であっても落とさない (誤爆の機械的防止)
 *
 * 既定は **list のみ**。破壊的操作は `--kill` を明示したときだけ行う。
 *
 * ## 使い方
 *
 *   npm run agent:cleanup                 # 自分の残骸を一覧 (kill しない)
 *   npm run agent:cleanup -- --kill       # lock 保持者を除外して停止
 *   npm run agent:cleanup -- --json       # 機械可読出力
 *   npm run agent:cleanup -- --pid <n>    # 起点セッション PID を明示 (自動解決に失敗するとき)
 *
 * ## 関連
 *   - scripts/lib/heavy-process.mjs (対象決定の純関数)
 *   - scripts/lib/agent-lock.mjs (lock 保持者の読み出し)
 *   - docs/sessions/agent-concurrency.md §中断後の後始末
 */

import { readdirSync } from 'node:fs';

import { lockDir, readLock } from './lib/agent-lock.mjs';
import { collectDescendants, planProcessCleanup } from './lib/heavy-process.mjs';
import { resolveSessionOwner, snapshotProcesses } from './lib/session-owner.mjs';

const HELP = `agent-cleanup — 中断後の検証プロセスを所有権単位で片付ける (#4069)

  --kill        実際に停止する (既定は一覧のみ)
  --json        JSON で出力する
  --pid <n>     起点となるセッション PID を明示する
  --help        このヘルプ

lock 保持者 (自分以外のセッション) とその子孫は常に除外される。
`;

/**
 * 現在の全 lock の保持者 PID を集める。
 *
 * @param {number | null} selfPid 自分のセッション PID (自分の lock は除外対象にしない)
 * @returns {{pid: number, key: string}[]}
 */
function readLockHolderPids(selfPid) {
	/** @type {{pid: number, key: string}[]} */
	const holders = [];
	let files;
	try {
		files = readdirSync(lockDir());
	} catch {
		return holders; // lock ディレクトリが無い = 保持者ゼロ
	}
	for (const file of files) {
		if (!file.endsWith('.lock')) continue;
		const key = file.replace(/\.lock$/, '');
		let holder = null;
		try {
			holder = readLock(key);
		} catch {
			// 壊れた lock は「保持者不明」。掃除は保守的に倒し、除外もしない
			// (中身が読めない lock で自分の掃除を永久に止めない)。
			continue;
		}
		const pid = holder?.ownerPid;
		if (!Number.isInteger(pid) || pid === null) continue;
		if (selfPid !== null && pid === selfPid) continue;
		holders.push({ pid: /** @type {number} */ (pid), key });
		for (const guarded of holder?.guardedPids ?? []) holders.push({ pid: guarded, key });
	}
	return holders;
}

function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(HELP);
		return 0;
	}
	const doKill = argv.includes('--kill');
	const asJson = argv.includes('--json');
	const pidArgIndex = argv.indexOf('--pid');
	/** @type {number | null} */
	let explicitPid = null;
	if (pidArgIndex >= 0) {
		const raw = argv[pidArgIndex + 1];
		const parsed = Number(raw);
		// 明示引数の誤りは**黙って自動解決に落とさない**。`--pid abc` を無視して
		// 別の起点で kill すると、ユーザーが指定したつもりのものと違うものが落ちる。
		if (!Number.isInteger(parsed) || parsed <= 0) {
			process.stderr.write(
				`[agent-cleanup] --pid の値が不正です (received: ${JSON.stringify(raw ?? null)})。正の整数を渡してください。\n`,
			);
			return 1;
		}
		explicitPid = parsed;
	}

	const table = snapshotProcesses();
	const ownerPid = explicitPid ?? resolveSessionOwner(process.ppid, table).pid;

	if (!ownerPid) {
		process.stderr.write(
			'[agent-cleanup] 起点セッションを解決できませんでした。--pid <n> で明示してください。\n' +
				'  (解決できないまま推測で kill すると、他セッションを巻き込みます)\n',
		);
		return 1;
	}

	const holders = readLockHolderPids(ownerPid);
	// `--pid <n>` は「この PID の系列は自分のものだ」というユーザーの明示宣言である。
	// ここで guardedPids 由来の保護を残すと、**まさに掃除したいオーファン** (停止した
	// セッションの lock に guarded として記録されている) が除外され、案内どおりに
	// 操作しても永久に落とせない (#4094 QA M3)。宣言された系列だけ保護を外す。
	// 他セッションの lock 保持者 PID そのものは、系列外なら従来どおり除外される。
	const declaredTree = explicitPid
		? new Set([explicitPid, ...collectDescendants(table, explicitPid)])
		: new Set();
	const protectedPids = holders.map((h) => h.pid).filter((pid) => !declaredTree.has(pid));
	const droppedProtection = holders.filter((h) => declaredTree.has(h.pid));
	const plan = planProcessCleanup({ table, ownerPid, protectedPids });

	if (asJson) {
		process.stdout.write(
			`${JSON.stringify(
				{
					ownerPid,
					descendants: collectDescendants(table, ownerPid).length,
					lockHolders: holders,
					declaredTree: [...declaredTree],
					droppedProtection,
					targets: plan.targets.map((p) => ({ pid: p.pid, name: p.name, cmd: p.cmd })),
					excluded: plan.excluded,
					unowned: plan.unowned.map((p) => ({ pid: p.pid, name: p.name, cmd: p.cmd })),
					killed: doKill,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		process.stdout.write(`[agent-cleanup] 起点セッション pid=${ownerPid}\n`);
		if (droppedProtection.length > 0) {
			process.stdout.write(
				`  --pid ${explicitPid} 系列として保護を外した lock 記録: ${droppedProtection
					.map((h) => `${h.pid} (${h.key})`)
					.join(', ')}\n`,
			);
		}
		const keptProtection = holders.filter((h) => !declaredTree.has(h.pid));
		if (keptProtection.length > 0) {
			process.stdout.write(
				`  lock 保持者 (除外): ${keptProtection.map((h) => `${h.pid} (${h.key})`).join(', ')}\n`,
			);
		}
		for (const ex of plan.excluded) {
			process.stdout.write(`  除外 pid=${ex.pid} (${ex.reason})\n`);
		}
		if (plan.targets.length === 0) {
			process.stdout.write('  自分の子孫に残骸なし\n');
		}
		for (const proc of plan.targets) {
			process.stdout.write(`  対象 pid=${proc.pid} ${proc.cmd.slice(0, 160)}\n`);
		}
		// 「対象なし」だけを見せると、detach された自分の残骸を見落として全 kill に
		// 手が伸びる。所有者を辿れないものは必ず出す (kill はしない)。
		if (plan.unowned.length > 0) {
			process.stdout.write(
				'  ⚠ 所有者を辿れない重い検証プロセス (kill しません。他セッションの実行中かもしれません):\n',
			);
			for (const proc of plan.unowned) {
				process.stdout.write(`    pid=${proc.pid} ${proc.cmd.slice(0, 160)}\n`);
			}
			process.stdout.write(
				'    自分の残骸だと確信できる場合のみ、その起点 PID を --pid <n> で指定して再実行してください。\n',
			);
		}
	}

	if (!doKill) {
		if (!asJson && plan.targets.length > 0) {
			process.stdout.write('  停止するには --kill を付けて再実行してください。\n');
		}
		return 0;
	}

	let failed = 0;
	for (const proc of plan.targets) {
		try {
			process.kill(proc.pid, 'SIGKILL');
		} catch (err) {
			failed++;
			const message =
				err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
			process.stderr.write(`[agent-cleanup] pid=${proc.pid} を停止できませんでした: ${message}\n`);
		}
	}
	if (!asJson) {
		process.stdout.write(
			`[agent-cleanup] 停止 ${plan.targets.length - failed} 件 / 失敗 ${failed} 件\n`,
		);
	}
	return failed > 0 ? 1 : 0;
}

process.exit(main());
