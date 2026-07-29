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
 * ### 同一性は sessionId、生存判定はセッションプロセス (Issue #4013)
 *
 * 当初は持ち主を `process.ppid` の 1 値で表していたが、**hook の親プロセスは短命**で、
 * 同一セッションでも呼び出しごとに別 PID になる。その結果
 *
 * - 再入判定 (`ownerPid` 一致) が効かず、
 * - `release` が持ち主不一致で常に no-op になり、
 * - `isProcessAlive(ownerPid)` が常に false を返して lock が取得直後から stale になる
 *
 * という三重の破綻が起きていた (2026-07-27 実測: 同一 `sessionId` の lock 5 本が
 * 別々の `ownerPid` を持ち、1 分後には全て死亡)。よって役割を 2 つに分ける。
 *
 * | 役割 | 使う値 |
 * |---|---|
 * | **同一性** (再入・解放の照合) | `sessionId` (無ければ `ownerPid` にフォールバック) |
 * | **生存判定** (セッション断の回収) | `ownerPid` = 祖先を辿って得たセッションプロセス (`session-owner.mjs`) |
 *
 * `ownerPid` が解決できなかった場合は `null` を記録し、**生存判定を行わず TTL のみ**で
 * 判定する。短命な PID を持ち主として記録するより、判定しないほうが安全である
 * (誤った「死んでいる」判定は排他そのものを消す)。
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
 * @property {number | null} ownerPid 保持者 (Claude セッション) の PID。解決できなければ null (#4013)
 * @property {number[] | null} [guardedPids] **保護対象**の検証プロセス PID 群 (#4083)。1 つでも生きていれば lock は失効しない
 * @property {string | null} [ownerVia] 持ち主 PID をどう決めたか (`session-owner.mjs` の判定経路)
 * @property {number[] | null} [chain] 持ち主に辿り着くまでに通った祖先 PID 列 (#4013 の証跡)
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
 * 2 つの持ち主が同一セッションか。
 *
 * `sessionId` を持つ側が 1 つでもあれば `sessionId` 同士で比べる。**片方だけが
 * `sessionId` を持つ場合は「別物」**とする — PID が偶然一致しただけで再入と
 * みなすと、他セッションの lock を奪ってしまうため。
 *
 * @param {{sessionId?: string | null, ownerPid?: number | null} | null} a
 * @param {{sessionId?: string | null, ownerPid?: number | null} | null} b
 * @returns {boolean}
 */
export function sameOwner(a, b) {
	if (!a || !b) return false;
	const aSid = a.sessionId ?? null;
	const bSid = b.sessionId ?? null;
	if (aSid !== null || bSid !== null) return aSid !== null && aSid === bSid;
	return Number.isInteger(a.ownerPid) && a.ownerPid === b.ownerPid;
}

/**
 * lock が失効しているか (持ち主が死んだ / TTL 超過)。
 *
 * `ownerPid` が記録されていない (セッションプロセスを解決できなかった) 場合は
 * **生存判定を行わず TTL のみ**で判定する。解決できない値を「死んでいる」と読むと、
 * 生きているセッションの lock を全員が奪えるようになり排他が消えるためである (#4013)。
 *
 * @param {LockHolder | null} holder
 * @param {number} now
 * @returns {boolean}
 */
export function isStale(holder, now = Date.now()) {
	if (!holder || typeof holder !== 'object') return true;
	// **保護対象プロセスが実在する限り lock は生きている** (#4083 AC1)。
	// 起動元セッションが先に落ちても、検証プロセスは detach して走り続ける。
	// ここで「持ち主が死んだ」だけを見て奪わせると、走行中の検証と並列に 2 本目が
	// 始まり、両方の結果が根拠として使えなくなる (2026-07-29 21:11-21:18 実測)。
	// TTL より優先する — 1 時間を超えても走っている検証は保護対象である。
	if (livePids(holder.guardedPids).length > 0) return false;
	const pid = holder.ownerPid;
	// PID があるときだけ生存判定する。無い (null) のは「解決できなかった」であって
	// 「死んでいる」ではない。
	if (typeof pid === 'number' && Number.isInteger(pid) && pid > 0 && !isProcessAlive(pid)) {
		return true;
	}
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
 * 与えられた PID 群のうち、実際に生きているものだけを返す。
 *
 * @param {number[] | null | undefined} pids
 * @returns {number[]}
 */
export function livePids(pids) {
	if (!Array.isArray(pids)) return [];
	return pids.filter((p) => Number.isInteger(p) && p > 0 && isProcessAlive(p));
}

/**
 * 文字列フィールドを正規化する。空文字・非文字列は「無い」= null に落とす。
 *
 * @param {unknown} v
 * @returns {string | null}
 */
function asStringOrNull(v) {
	return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * PID 列フィールドを正規化する。**1 要素でも PID として不正なら配列ごと null** にする。
 *
 * 部分的に壊れた鎖を残すと、後から検証する人が「辿れた経路」として読んでしまう。
 * 証跡は「正しいか、無いか」のどちらかであるべきで、半分だけ正しい形を作らない。
 *
 * @param {unknown} v
 * @returns {number[] | null}
 */
function asPidArrayOrNull(v) {
	if (!Array.isArray(v) || v.length === 0) return null;
	return v.every((p) => typeof p === 'number' && Number.isInteger(p) && p > 0)
		? /** @type {number[]} */ (v)
		: null;
}

/**
 * パース済みの lock レコードを `LockHolder` の形に正規化する。
 *
 * lock ファイルは `~/.buzz/.locks/` にあり、**同一マシンの任意のプロセスが書ける**。
 * 本 module が唯一の書き手であるという前提は保証されていないので、JSDoc による型の
 * 言い換え (cast) は runtime の保証にならない (#4013 / QM 指摘)。`ownerVia` / `chain`
 * を「後から検証できる証跡」として載せる以上、その土台を未検証のままにはできない
 * ため、読み出し時に 1 枚挟む。
 *
 * 壊れた値の落とし先は**フィールドごとに違う**。理由は「安全な既定値があるか」である。
 *
 * | フィールド | 壊れていたら | なぜ |
 * |---|---|---|
 * | `ownerPid` | `null` に落とす | `null` = 「持ち主を解決できなかった」は本設計に既存の正当な状態。以降は生存判定せず TTL のみで判定する。**「死んでいる」と読んで奪うと排他が消える** (#4013 の根と同型) |
 * | `startedAt` | **例外** | TTL 判定の基準時刻であり、安全な既定値が存在しない。`0` に落とすと `now - 0 > ttl` で即 stale = 生きている lock を奪う。判定できないなら通さない (fail closed) |
 *
 * **`startedAt` の破損だけは TTL で回収されない。** 本関数の throw は `acquire` /
 * `release` が catch しないためそのまま伝播し、TTL 判定に到達しない。他フィールドの
 * 破損は読み出しに成功するので最大 `DEFAULT_TTL_MS` で自動回収されるが、`startedAt`
 * は手で lock ファイルを消すまで block が続く。hook 側の catch が削除を案内する。
 * | `ttlMs` | `DEFAULT_TTL_MS` | 最大 1 時間で回収されるだけで、奪う方向には効かない |
 * | `chain` | `null` に落とす (1 要素でも不正なら配列ごと) | 半分だけ正しい証跡は誤読の元。証跡は「正しいか、無いか」のどちらかにする |
 * | `sessionId` / その他 | `null` に落とす | 同一性が取れなくなるので再入・解放が no-op になり、TTL 満了まで**誰も取れない**。fail closed 側 |
 *
 * @param {unknown} parsed
 * @returns {LockHolder}
 */
function normalizeHolder(parsed) {
	if (!parsed || typeof parsed !== 'object') throw new Error('object ではありません');
	const o = /** @type {Record<string, unknown>} */ (parsed);

	const rawStarted = o.startedAt;
	if (typeof rawStarted !== 'number' || !Number.isFinite(rawStarted)) {
		// ここだけ例外。TTL 判定の基準を失った lock は「まだ生きている」とも
		// 「もう死んでいる」とも言えない。判定できない状態で奪わせない。
		throw new Error(`startedAt が数値ではありません (received: ${JSON.stringify(rawStarted)})`);
	}

	const rawPid = o.ownerPid;
	const ownerPid =
		typeof rawPid === 'number' && Number.isInteger(rawPid) && rawPid > 0 ? rawPid : null;

	const rawTtl = o.ttlMs;
	const ttlMs = typeof rawTtl === 'number' && Number.isFinite(rawTtl) ? rawTtl : DEFAULT_TTL_MS;

	// `guardedPids` は「奪ってよいか」を左右する値なので、`startedAt` と同じ扱いにする。
	// 壊れた値を `null` に落とすと「保護対象なし」= 奪える方向に倒れ、走行中の検証を
	// 巻き込む (#4083 の再発)。判定できないなら通さない。空配列は「保護対象なし」で正当。
	const rawGuarded = o.guardedPids;
	let guardedPids = null;
	if (rawGuarded !== undefined && rawGuarded !== null) {
		if (!Array.isArray(rawGuarded)) {
			throw new Error(`guardedPids が配列ではありません (received: ${JSON.stringify(rawGuarded)})`);
		}
		if (rawGuarded.length > 0) {
			guardedPids = asPidArrayOrNull(rawGuarded);
			if (guardedPids === null) {
				throw new Error(
					`guardedPids に不正な PID があります (received: ${JSON.stringify(rawGuarded)})`,
				);
			}
		}
	}

	return {
		key: asStringOrNull(o.key) ?? undefined,
		ownerPid,
		guardedPids,
		ownerVia: asStringOrNull(o.ownerVia),
		chain: asPidArrayOrNull(o.chain),
		agent: asStringOrNull(o.agent),
		target: asStringOrNull(o.target),
		cwd: asStringOrNull(o.cwd),
		sessionId: asStringOrNull(o.sessionId),
		startedAt: rawStarted,
		ttlMs,
	};
}

/**
 * lock の現在の持ち主を読む。未取得なら null。
 *
 * 壊れた lock ファイルは **stale ではなく例外**にする。中身が読めない = 排他が
 * 成立しているか判定できない状態であり、黙って奪うと二重実行を許すためである。
 *
 * フィールド単位の検証は `normalizeHolder` が行う。**型 cast は runtime validation
 * ではない**ので、ここを通さずに `LockHolder` として扱ってはならない。
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
		return normalizeHolder(JSON.parse(raw));
	} catch (err) {
		throw new Error(`agent-lock: lock が壊れています (${path}): ${errInfo(err).message}`);
	}
}

/**
 * lock を取る。
 *
 * 同一セッションからの再取得は成功扱い (再入可能) で、`startedAt` を更新する。
 * 別の持ち主が生きている間は失敗し、その持ち主を返す。
 *
 * `sessionId` と `ownerPid` の**どちらも無い**呼び出しは、持ち主を識別できないため例外にする。
 *
 * @param {string} key
 * @param {{ownerPid?: number | null, sessionId?: string | null, ownerVia?: string | null, ownerChain?: number[] | null, guardedPids?: number[] | null, agent?: string | null, target?: string | null, cwd?: string | null, ttlMs?: number, now?: number}} opts
 * @returns {{ok: true, holder: LockHolder} | {ok: false, holder: LockHolder | null}}
 */
export function acquire(key, opts) {
	const now = typeof opts?.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();
	const rawPid = opts?.ownerPid;
	const ownerPid =
		typeof rawPid === 'number' && Number.isInteger(rawPid) && rawPid > 0 ? rawPid : null;
	const sessionId = opts?.sessionId ?? null;
	if (ownerPid === null && sessionId === null) {
		throw new Error('agent-lock: 持ち主を識別できません (sessionId と ownerPid がどちらも空)');
	}
	if (rawPid !== undefined && rawPid !== null && ownerPid === null) {
		throw new Error(`agent-lock: ownerPid が不正です (received: ${JSON.stringify(rawPid)})`);
	}

	const record = {
		key,
		ownerPid,
		// 取得時点では検証プロセスはまだ起動していない。実 PID は `releaseUnlessGuarded`
		// (PostToolUse) が走行中プロセスを見つけたときに書き込む (#4083)。
		guardedPids: asPidArrayOrNull(opts?.guardedPids),
		// 持ち主 PID をどう決めたかの記録。実環境で解決に失敗していないかを、
		// lock ファイルを見るだけで後から検証できるようにする (#4013)。
		ownerVia: opts?.ownerVia ?? null,
		chain: asPidArrayOrNull(opts?.ownerChain),
		agent: opts?.agent ?? null,
		target: opts?.target ?? null,
		cwd: opts?.cwd ?? null,
		sessionId,
		startedAt: now,
		ttlMs:
			typeof opts?.ttlMs === 'number' && Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS,
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
	if (sameOwner(current, record)) {
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
 * 照合は `sameOwner` と同じ規則 (sessionId 優先)。取得時と解放時で PID が変わる
 * 実行環境があるため、PID 一致を条件にすると解放が永久に no-op になる (#4013)。
 *
 * @param {string} key
 * @param {{sessionId?: string | null, ownerPid?: number | null} | number} owner
 * @returns {boolean} 実際に解放したか
 */
export function release(key, owner) {
	const claim = typeof owner === 'number' ? { ownerPid: owner, sessionId: null } : owner;
	const current = readLock(key);
	if (!current) return false;
	if (!sameOwner(current, claim)) return false;
	rmSync(lockPath(key), { force: true });
	return true;
}

/**
 * lock を返す。ただし**保護対象プロセスがまだ走っていれば返さない** (#4083 AC1)。
 *
 * `release` との違いはここだけである。PostToolUse は「Bash tool が終わった」時点で
 * 走るが、それは**検証プロセスが終わったこと**を意味しない。ハーネスが tool を kill
 * した場合、プロセスは detach したまま走り続ける。そこで無条件に解放すると
 * 「走っているのに lock が無い」状態が生まれ、第三者が並列に検証を始められてしまう。
 *
 * 保護対象が残っている場合は解放せず、その PID を lock に書き戻す。これにより
 * 以後の `isStale` が**プロセスの実在**で判定できるようになり、逆に全部死んだ後は
 * 自動的に stale として回収される (#4069 AC3 と同一判定)。
 *
 * @param {string} key
 * @param {{sessionId?: string | null, ownerPid?: number | null} | number} owner
 * @param {number[]} guardedPids 解放時点で走っている検証プロセスの PID 群
 * @returns {{released: boolean, guardedPids: number[]}}
 */
export function releaseUnlessGuarded(key, owner, guardedPids = []) {
	const claim = typeof owner === 'number' ? { ownerPid: owner, sessionId: null } : owner;
	const current = readLock(key);
	if (!current) return { released: false, guardedPids: [] };
	if (!sameOwner(current, claim)) return { released: false, guardedPids: [] };

	const alive = livePids(guardedPids);
	if (alive.length === 0) {
		rmSync(lockPath(key), { force: true });
		return { released: true, guardedPids: [] };
	}
	const next = { ...current, guardedPids: alive };
	writeFileSync(lockPath(key), `${JSON.stringify(next, null, 2)}\n`);
	return { released: false, guardedPids: alive };
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
	// PID を解決できなかった lock は TTL のみで回収されるため、その旨を出す。
	const owner = Number.isInteger(holder.ownerPid)
		? `pid=${holder.ownerPid}`
		: `pid=不明 (TTL のみで回収)`;
	const parts = [owner, `経過=${ageSec}s`];
	if (holder.sessionId) parts.push(`session=${holder.sessionId}`);
	if (holder.agent) parts.push(`agent=${holder.agent}`);
	if (holder.target) parts.push(`target=${holder.target}`);
	if (holder.cwd) parts.push(`cwd=${holder.cwd}`);
	return parts.join(' / ');
}
