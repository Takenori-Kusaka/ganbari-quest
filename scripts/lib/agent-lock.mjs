/**
 * 複数エージェントセッション間の排他ロック SSOT。
 *
 * ## なぜ必要か
 *
 * 本リポジトリは Buzz 上の複数エージェント (Dev / QM / PO / 監査) が **同一マシン**で
 * 並走する。Buzz はチャンネルごとに ACP セッションを作るため、**同じエージェントでも
 * 複数セッションが同時に動く**。セッション同士は互いを知らないので、調整する仕組みが
 * 無いと以下が起きる (いずれも 2026-07-26〜27 に実測):
 *
 * - 同一 PR に対する `pre-ready` が **2 本**同時起動 (片方は必ず捨てられる純粋な無駄)
 * - 同一 checkout で `vitest` が **3 本**同時実行 → 負荷で timeout が量産され、
 *   「落ちた」も「通った」も根拠にならない結果になる
 * - 別セッションと作業が二重になることを恐れて着手が止まる
 *
 * 「各セッションの自制」に頼る形では防げない。自制は自分の残存プロセスしか見ないが、
 * 実際に踏むのは**他セッション**だからである。よって機械強制する。
 *
 * ## 設計
 *
 * lock はファイル 1 個 = key 1 個。lock ディレクトリは **repo の外** (`~/.buzz/.locks`) に置く。
 * checkout / worktree が複数あっても同じマシンなら同じ lock を見るためである。
 *
 * | key | 意味 | 排他の粒度 |
 * |---|---|---|
 * | `heavy` | 重い検証 (pre-ready / vitest / playwright / svelte-check) の実行枠 | マシン全体で 1 本 |
 * | `task:<n>` | Issue #n の作業占有 | Issue 単位 |
 *
 * ### 生存判定に PID を使う
 *
 * lock の持ち主は **Claude セッションのプロセス** (hook から見た `process.ppid`) とする。
 * そのプロセスが死んでいれば lock は stale とみなして奪える。Buzz のセッション断
 * (idle timeout / ACP 切断) でプロセスごと消えるケースを、TTL の満了を待たずに回収できる。
 *
 * TTL は「プロセスは生きているが処理が終わらない」ケースの保険であり、生存判定の代替ではない。
 *
 * ### 失敗したら通さない (fail closed)
 *
 * lock ディレクトリが読めない・壊れた lock が置かれている等、**排他が成立しているか
 * 判定できない**状態では acquire を失敗させる。「判定できない」まま重い検証を走らせると、
 * 汚染された結果を根拠に使ってしまうためである (Issue #3999 と同じ思想)。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 既定 TTL: 重い検証の実測最長 (統合 e2e 909s) に余裕を見た値。 */
export const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * lock ファイルに書かれる保持者レコード。
 *
 * `object` のままだと TS strict (svelte-check) が `holder.ownerPid` 等の参照を
 * 「Property does not exist on type 'object'」で弾く。lock の中身は本 module が
 * 唯一の書き手なので、形を typedef として明示する。
 *
 * @typedef {object} LockHolder
 * @property {string} [key] lock の key
 * @property {number} ownerPid 保持者 (Claude セッション) の PID
 * @property {string | null} [agent] エージェント名 (GQ-Dev 等)
 * @property {string | null} [target] 作業対象 (PR #1234 等)
 * @property {string | null} [cwd] 実行 checkout
 * @property {string | null} [sessionId] セッション識別子
 * @property {number} [startedAt] 取得時刻 (epoch ms)
 * @property {number} [ttlMs] TTL
 */

/**
 * catch した値から errno / message を安全に取り出す。
 *
 * TS strict では catch 変数が `unknown` になるため、`err.code` / `err.message` を
 * そのまま触れない。実行時の挙動は変えず、型の上でだけ絞る。
 *
 * @param {unknown} err
 * @returns {{code: string | undefined, message: string}}
 */
function errInfo(err) {
	const e = /** @type {{code?: unknown, message?: unknown}} */ (
		err && typeof err === 'object' ? err : {}
	);
	return {
		code: typeof e.code === 'string' ? e.code : undefined,
		message: typeof e.message === 'string' ? e.message : String(err),
	};
}

/** lock 置き場。テストからは `AGENT_LOCK_DIR` で差し替える。 */
export function lockDir() {
	return process.env.AGENT_LOCK_DIR || join(homedir(), '.buzz', '.locks');
}

/**
 * key をファイル名に落とす。`task:3963` → `task-3963.lock`
 *
 * @param {string} key
 * @returns {string}
 */
export function lockPath(key) {
	const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '-');
	if (safe === '' || safe.replace(/-/g, '') === '') {
		throw new Error(`agent-lock: 空の key は使えません (received: ${JSON.stringify(key)})`);
	}
	return join(lockDir(), `${safe}.lock`);
}

/**
 * プロセスが生きているか。存在しない PID なら false。
 *
 * `process.kill(pid, 0)` はシグナルを送らず存在確認だけを行う。
 * EPERM は「他ユーザーのプロセスとして存在する」なので生存扱いにする。
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return errInfo(err).code === 'EPERM';
	}
}

/**
 * lock が失効しているか (持ち主が死んだ / TTL 超過)。
 *
 * @param {LockHolder | null} holder
 * @param {number} now
 * @returns {boolean}
 */
export function isStale(holder, now = Date.now()) {
	if (!holder || typeof holder !== 'object') return true;
	if (!isProcessAlive(holder.ownerPid)) return true;
	// `Number.isFinite(x)` は型述語ではないため、TS strict では x が
	// `number | undefined` のままになる。数値を先に取り出してから判定する。
	const ttl =
		typeof holder.ttlMs === 'number' && Number.isFinite(holder.ttlMs)
			? holder.ttlMs
			: DEFAULT_TTL_MS;
	const started =
		typeof holder.startedAt === 'number' && Number.isFinite(holder.startedAt)
			? holder.startedAt
			: 0;
	return now - started > ttl;
}

/**
 * lock の現在の持ち主を読む。未取得なら null。
 *
 * 壊れた lock ファイルは **stale ではなく例外**にする。中身が読めない = 排他が
 * 成立しているか判定できない状態であり、黙って奪うと二重実行を許すためである。
 *
 * @param {string} key
 * @returns {LockHolder | null}
 */
export function readLock(key) {
	const path = lockPath(key);
	if (!existsSync(path)) return null;
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		throw new Error(`agent-lock: lock を読めません (${path}): ${errInfo(err).message}`);
	}
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') throw new Error('object ではありません');
		return /** @type {LockHolder} */ (parsed);
	} catch (err) {
		throw new Error(`agent-lock: lock が壊れています (${path}): ${errInfo(err).message}`);
	}
}

/**
 * lock を取る。
 *
 * 同じ `ownerPid` からの再取得は成功扱い (再入可能) で、`startedAt` を更新する。
 * 別の持ち主が生きている間は失敗し、その持ち主を返す。
 *
 * @param {string} key
 * @param {{ownerPid: number, agent?: string, target?: string, cwd?: string, sessionId?: string, ttlMs?: number, now?: number}} opts
 * @returns {{ok: true, holder: LockHolder} | {ok: false, holder: LockHolder | null}}
 */
export function acquire(key, opts) {
	const now = Number.isFinite(opts?.now) ? opts.now : Date.now();
	const ownerPid = opts?.ownerPid;
	if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
		throw new Error(`agent-lock: ownerPid が不正です (received: ${JSON.stringify(ownerPid)})`);
	}

	const record = {
		key,
		ownerPid,
		agent: opts?.agent ?? null,
		target: opts?.target ?? null,
		cwd: opts?.cwd ?? null,
		sessionId: opts?.sessionId ?? null,
		startedAt: now,
		ttlMs: Number.isFinite(opts?.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS,
	};

	mkdirSync(lockDir(), { recursive: true });
	const path = lockPath(key);

	try {
		// `wx` = 既存なら EEXIST。存在確認と作成の間に別プロセスが割り込む余地を作らない。
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
		return { ok: true, holder: record };
	} catch (err) {
		if (errInfo(err).code !== 'EEXIST') throw err;
	}

	const current = readLock(key);
	if (current && current.ownerPid === ownerPid) {
		// 同一セッションの再入。TTL を延長する。
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
		return { ok: true, holder: record };
	}
	if (isStale(current, now)) {
		writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
		return { ok: true, holder: record };
	}
	return { ok: false, holder: current };
}

/**
 * lock を返す。持ち主が違う場合は何もしない (false を返す)。
 *
 * @param {string} key
 * @param {number} ownerPid
 * @returns {boolean} 実際に解放したか
 */
export function release(key, ownerPid) {
	const current = readLock(key);
	if (!current) return false;
	if (current.ownerPid !== ownerPid) return false;
	rmSync(lockPath(key), { force: true });
	return true;
}

/**
 * 保持中の lock を人間可読の 1 行にする (block メッセージ用)。
 *
 * @param {LockHolder | null} holder
 * @param {number} now
 * @returns {string}
 */
export function describeHolder(holder, now = Date.now()) {
	if (!holder) return '(不明)';
	const ageSec = Math.max(0, Math.round((now - (holder.startedAt ?? now)) / 1000));
	const parts = [`pid=${holder.ownerPid}`, `経過=${ageSec}s`];
	if (holder.agent) parts.push(`agent=${holder.agent}`);
	if (holder.target) parts.push(`target=${holder.target}`);
	if (holder.cwd) parts.push(`cwd=${holder.cwd}`);
	return parts.join(' / ');
}
