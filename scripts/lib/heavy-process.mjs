/**
 * 走行中の「重い検証プロセス」を、プロセス表から所有権つきで扱う SSOT。
 *
 * ## なぜ lock ファイルだけでは足りないか (Issue #4083)
 *
 * lock の寿命は**起動主体 (セッション)** に紐づいていた。検証は detach した
 * バックグラウンドプロセスとして走るため、セッションが先に落ちると
 * **プロセスは生きたまま lock だけ消える**。2026-07-29 21:11 起動の
 * `pre-ready --pr 4081` が生存中に lock ファイルが存在せず、21:18 に別セッションが
 * BLOCK なしで 2 本目を開始した (= 両方の結果が根拠として使えなくなった)。
 *
 * よって排他の判定は「lock ファイルがあるか」ではなく **保護対象プロセスが実在するか**
 * に紐づける。本 module はその「実在」を答える層である。
 *
 * ## なぜ所有権が要るか (Issue #4069)
 *
 * 中断後の掃除手段が `taskkill /F /IM node.exe` (全 node kill) しかなかったため、
 * lock を正当に保持して検証中だった別セッション (PR #4063) まで巻き込んで停止した。
 * 掃除は「自分の子孫」に限定し、lock 保持者とその子孫は**機械的に除外**する。
 *
 * プロセス表の取得は `session-owner.mjs` の `snapshotProcesses()` を共用する
 * (spawn を 2 種類持たない)。純関数側 (`findHeavyProcesses` / `collectDescendants` /
 * `planProcessCleanup`) は表を引数で受けるため、実プロセスなしで test できる。
 */

/**
 * @typedef {import('./session-owner.mjs').ProcInfo} ProcInfo
 */

/**
 * 走行中プロセスのコマンドラインが「重い検証」か。
 *
 * ここはコマンド**文字列の入力**ではなく **OS が持つ実行中プロセスの cmdline** を見る。
 * すでに起動しているものを同定する用途なので、`agent-lock-policy.mjs` の構造判定
 * (これから実行する文字列を解釈する) とは対象が違う。実行ファイル / スクリプトパスの
 * 位置に現れる名前だけを見る点は共通で、`--body-file tmp/issue-svelte-check.md` のような
 * 引数中の出現には反応しない。
 */
const HEAVY_PROCESS_PATTERNS = [
	// 実体ファイルを直接叩く形: .../pre-ready.mjs / .../vitest.mjs / .../svelte-check
	// パス区切りの直後に名前が来ることを要求するので、`tmp/issue-svelte-check-infra.md`
	// のような「名前を含むだけのパス」には反応しない。
	/(^|[\s"'])[^\s"']*[/\\](pre-ready\.mjs|vitest[^/\\\s"']*|svelte-check[^/\\\s"']*)(\s|$|["'])/,
	// bin 名で叩く形 (PATH 解決)。**引用符の直後は対象外**にする — 引用符始まりを許すと
	// `--title "svelte-check がローカルでしか回らない"` を実行と誤認する (#4071 と同じ誤り)。
	/(^|\s)(vitest|svelte-check)(\.cmd|\.exe)?(\s|$)/,
	// playwright は `test` サブコマンドのときだけ重い。
	/(^|[\s"'])([^\s"']*[/\\])?playwright[^/\\\s"']*["']?\s+test(\s|$)/,
];

/**
 * プロセスのコマンドラインが重い検証か。
 *
 * @param {string} cmd
 * @returns {boolean}
 */
export function isHeavyProcessCmdline(cmd) {
	const text = String(cmd ?? '');
	if (text.trim() === '') return false;
	return HEAVY_PROCESS_PATTERNS.some((re) => re.test(text));
}

/**
 * 走行中の重い検証プロセスを列挙する。
 *
 * `excludePids` には「自分が起動した / これから起動する分」を渡す。ここを渡さないと
 * 自分自身の実行を自分で BLOCK してしまう。
 *
 * @param {Map<number, ProcInfo>} table
 * @param {{excludePids?: number[]}} [opts]
 * @returns {ProcInfo[]}
 */
export function findHeavyProcesses(table, opts) {
	const exclude = new Set(opts?.excludePids ?? []);
	/** @type {ProcInfo[]} */
	const found = [];
	for (const proc of table.values()) {
		if (exclude.has(proc.pid)) continue;
		if (!isHeavyProcessCmdline(proc.cmd)) continue;
		found.push(proc);
	}
	return found.sort((a, b) => a.pid - b.pid);
}

/**
 * 指定 PID の子孫をすべて返す (自身は含まない)。
 *
 * @param {Map<number, ProcInfo>} table
 * @param {number} rootPid
 * @returns {number[]}
 */
export function collectDescendants(table, rootPid) {
	if (!Number.isInteger(rootPid) || rootPid <= 0) return [];
	/** @type {Map<number, number[]>} */
	const children = new Map();
	for (const proc of table.values()) {
		const list = children.get(proc.ppid);
		if (list) list.push(proc.pid);
		else children.set(proc.ppid, [proc.pid]);
	}
	/** @type {number[]} */
	const out = [];
	const seen = new Set([rootPid]);
	const queue = [rootPid];
	while (queue.length > 0) {
		const pid = /** @type {number} */ (queue.shift());
		for (const child of children.get(pid) ?? []) {
			if (seen.has(child)) continue;
			seen.add(child);
			out.push(child);
			queue.push(child);
		}
	}
	return out;
}

/**
 * 掃除の対象と除外を決める (#4069 AC1 / AC2)。
 *
 * - **対象は `ownerPid` の子孫だけ**。他セッションのプロセスは候補にすら入れない
 * - `protectedPids` (= lock 保持者) **とその子孫**は、たとえ自分の子孫でも除外する
 *
 * 実際の kill は行わない。「何を落とすか」を決める判断だけを純関数に切り出し、
 * 破壊的操作は CLI (`scripts/agent-cleanup.mjs`) が担う。
 *
 * ## `unowned` を必ず報告する理由 (実測)
 *
 * ハーネスが起動した検証チェーンは**セッションの子孫から外れる**ことがある
 * (本 PR の作業中に実測: `pre-ready --pr 4094` の親が session owner ではなく別 PID
 * だった)。この場合 `targets` は空になるが、**残骸が無いわけではない**。
 * 「対象なし」とだけ出すと、実際には残っている残骸を見落として全 kill に手が伸びる —
 * 本 Issue が塞ごうとしている行動そのものである。よって所有者を辿れない重い検証は
 * `unowned` として**必ず可視化**する (kill 対象には決してしない)。
 *
 * @param {{table: Map<number, ProcInfo>, ownerPid: number | null, protectedPids?: number[]}} opts
 * @returns {{targets: ProcInfo[], excluded: {pid: number, name: string, reason: string}[], unowned: ProcInfo[]}}
 */
export function planProcessCleanup(opts) {
	const table = opts.table;
	const ownerPid = opts.ownerPid;
	if (!Number.isInteger(ownerPid) || Number(ownerPid) <= 0) {
		return { targets: [], excluded: [], unowned: [] };
	}

	/** lock 保持者とその子孫。除外集合。 */
	const protectedSet = new Set();
	for (const pid of opts.protectedPids ?? []) {
		if (!Number.isInteger(pid) || pid <= 0) continue;
		protectedSet.add(pid);
		for (const child of collectDescendants(table, pid)) protectedSet.add(child);
	}

	/** @type {ProcInfo[]} */
	const targets = [];
	/** @type {{pid: number, name: string, reason: string}[]} */
	const excluded = [];
	const ownDescendants = collectDescendants(table, Number(ownerPid));
	const ownSet = new Set([Number(ownerPid), ...ownDescendants]);
	for (const pid of ownDescendants) {
		const proc = table.get(pid);
		if (!proc) continue;
		// 掃除の目的は「重い検証の残骸」の回収。shell 等の中間プロセスは、落とすと
		// 親側の後始末を壊すので**候補にしない** (除外理由としても報告しない)。
		if (!isHeavyProcessCmdline(proc.cmd)) continue;
		if (protectedSet.has(pid)) {
			excluded.push({ pid, name: proc.name, reason: 'lock-holder' });
			continue;
		}
		targets.push(proc);
	}
	// 所有者を辿れない重い検証 (ハーネスが detach した自分の残骸 / 他セッションの実行中)。
	// **kill 対象にはしない**が、見えないままにもしない。
	const unowned = findHeavyProcesses(table, {
		excludePids: [...ownSet, ...protectedSet],
	});

	return {
		targets: targets.sort((a, b) => a.pid - b.pid),
		excluded: excluded.sort((a, b) => a.pid - b.pid),
		unowned,
	};
}

export default {
	isHeavyProcessCmdline,
	findHeavyProcesses,
	collectDescendants,
	planProcessCleanup,
};
