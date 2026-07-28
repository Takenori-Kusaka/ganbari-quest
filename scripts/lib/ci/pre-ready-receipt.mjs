/**
 * scripts/lib/ci/pre-ready-receipt.mjs — pre-ready 実行 receipt の SSOT (#4006)
 *
 * ## 何のための機構か
 *
 * PR body の「`npm run pre-ready -- --pr <num>` 全 Step PASS」チェックボックスは、
 * これまで **機械検証できない自己申告**だった。`pre-ready.mjs` は結果を stdout に出すだけで
 * PR に紐付く証跡を残さないため、レビュー側は「実行したか」も「どの PR / どの HEAD に対して
 * 実行したか」も原理的に検証できなかった (実害: #3994 = 存在しない PR 番号を証跡として引用 /
 * #4002 = 未実行のまま `[x]`)。
 *
 * 本 receipt は **事故 (accident) に対する証跡であって、偽造 (forgery) に対する証跡ではない**。
 * receipt は開発者自身の環境で生成され、手で書き換えることもできる。防いでいるのは
 * 「実行し忘れたまま `[x]` を付ける」「別 PR / 古い HEAD のログを流用する」といった
 * **善意の取り違え**であり、意図的な捏造ではない。ADR-0056 の approve evidence も同じ性質を持つ。
 *
 * TTL は設けない。pre-ready は数十分かかり、その後 CI 待ち・レビュー往復を挟むため、
 * ADR-0056 の 30 分 TTL をそのまま流用すると恒常的に失効する。**改竄耐性は TTL ではなく
 * 「receipt の HEAD SHA == PR の実 HEAD」の一致で担保する** (#4006 設計上の注意)。
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

/** receipt schema の版。破壊的変更時にインクリメントし、gate 側で不一致を検出する。 */
export const RECEIPT_SCHEMA_VERSION = 1;

/** receipt / lock file の格納先 (repoRoot 相対)。`tmp/` は .gitignore 済 = repo を汚さない。 */
export const RECEIPT_DIR = 'tmp/pre-ready-receipts';

/** receipt を識別する固定値。PR body 中の複数 code block から receipt を選ぶ鍵でもある。 */
export const RECEIPT_TOOL = 'pre-ready';

/** step の結果種別。`pass` 以外は全て「実行していない」理由を表す (#4018 の分類を再利用)。 */
export const STEP_OUTCOMES = /** @type {const} */ ([
	'pass',
	'fail',
	'skipped-flag',
	'skipped-script-missing',
	'skipped-na',
]);

// ---------------------------------------------------------------------------
// PR 実在確認 / HEAD SHA 取得 (AC2 / AC4 共通)
// ---------------------------------------------------------------------------

/**
 * `gh api repos/{owner}/{repo}/pulls/<N>` で PR の実 HEAD SHA を取得する。
 *
 * **`gh pr view <N> --json number` を使ってはならない** (#4006 AC4)。フィールドを 1 つだけ
 * 指定すると gh は実クエリを飛ばさず、存在しない PR でも `{"number":N}` を返すため、
 * #3994 の「Issue 番号を PR 番号として引用した」事故を検出できない。`gh api .../pulls/<N>` は
 * 存在しない PR に対して 404 を返す。
 *
 * @param {string|number} prNumber
 * @param {{ exec?: (cmd: string) => string }} [deps] test 用の実行関数差替え
 * @returns {{ ok: true; sha: string } | { ok: false; notFound: boolean; message: string }}
 */
export function fetchPrHeadSha(prNumber, deps = {}) {
	const num = String(prNumber);
	if (!/^\d+$/.test(num)) {
		return { ok: false, notFound: false, message: `PR 番号が数値ではありません: ${num}` };
	}
	const exec =
		deps.exec ??
		((cmd) =>
			execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }));
	let raw;
	try {
		raw = exec(`gh api "repos/{owner}/{repo}/pulls/${num}" --jq .head.sha`);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		// 404 は「PR 不在」= 確定的な失敗。それ以外 (未認証 / offline) は検証不能として区別する。
		const notFound = /HTTP 404|Not Found/i.test(msg);
		return { ok: false, notFound, message: msg.split('\n').slice(0, 3).join(' ') };
	}
	const sha = String(raw).trim();
	if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
		return {
			ok: false,
			notFound: false,
			message: `HEAD SHA の形式が不正です: ${sha.slice(0, 40)}`,
		};
	}
	return { ok: true, sha };
}

// ---------------------------------------------------------------------------
// 並走検知 (AC5)
// ---------------------------------------------------------------------------

/**
 * 実行環境のスナップショットを取る (AC5)。
 *
 * **`os.loadavg()` は使わない** — Windows では常に `[0, 0, 0]` を返す (本 repo の開発機は
 * win32、実測で確認済) ため、記録しても「負荷が無かった」という嘘の記録になる。
 *
 * 代わりに、pre-ready 自身が起動時に置く lock file を数えて **「起動時点で生きていた他の
 * pre-ready プロセス数」** を記録する。#3975 / #3994 で観測された偽 red は複数セッションの
 * pre-ready 並走が原因だったため、これが直接の判別材料になる。
 *
 * 限界も名前で正直に表す: 本値は **pre-ready 以外の負荷 (他セッションの vitest / build 等) を
 * 一切含まない**。フィールド名を `otherLivePreReadyRuns` としているのはそのため。
 *
 * @param {string} repoRoot
 * @param {number} [selfPid]
 * @returns {number}
 */
export function countOtherLivePreReadyRuns(repoRoot, selfPid = process.pid) {
	const dir = resolve(repoRoot, RECEIPT_DIR);
	if (!existsSync(dir)) return 0;
	let count = 0;
	for (const name of readdirSync(dir)) {
		if (!name.startsWith('.run-') || !name.endsWith('.json')) continue;
		const path = join(dir, name);
		/** @type {{ pid?: number } | null} */
		let lock = null;
		try {
			lock = JSON.parse(readFileSync(path, 'utf-8'));
		} catch {
			lock = null;
		}
		const pid = lock?.pid;
		if (typeof pid !== 'number' || pid === selfPid) continue;
		if (isPidAlive(pid)) {
			count += 1;
		} else {
			// 異常終了で残った lock は「並走している」ではないので掃除する (数を水増ししない)
			try {
				rmSync(path, { force: true });
			} catch {
				// 掃除失敗は計測結果に影響しないため無視する
			}
		}
	}
	return count;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM = 別ユーザーのプロセスだが「生きている」
		return /** @type {{ code?: string }} */ (e)?.code === 'EPERM';
	}
}

/**
 * 自分の lock file を置き、置く直前に見えていた他 run 数を返す。
 *
 * @param {string} repoRoot
 * @returns {{ lockPath: string; otherLivePreReadyRuns: number }}
 */
export function acquireRunLock(repoRoot) {
	const dir = resolve(repoRoot, RECEIPT_DIR);
	mkdirSync(dir, { recursive: true });
	const otherLivePreReadyRuns = countOtherLivePreReadyRuns(repoRoot);
	const lockPath = join(dir, `.run-${process.pid}.json`);
	writeFileSync(
		lockPath,
		JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
		'utf-8',
	);
	return { lockPath, otherLivePreReadyRuns };
}

/** @param {string} lockPath */
export function releaseRunLock(lockPath) {
	try {
		rmSync(lockPath, { force: true });
	} catch {
		// 残っても次回起動時に dead pid として掃除されるため無視する
	}
}

// ---------------------------------------------------------------------------
// receipt の生成 / 出力
// ---------------------------------------------------------------------------

/**
 * receipt オブジェクトを組み立てる (純関数)。
 *
 * @param {{
 *   pr: string | number | null;
 *   headSha: string;
 *   startedAt: string;
 *   finishedAt: string;
 *   status: 'ALL_PASS' | 'PARTIAL_PASS' | 'FAIL';
 *   steps: { name: string; outcome: string; durationMs?: number }[];
 *   otherLivePreReadyRuns: number;
 *   prExistenceVerified: boolean;
 * }} input
 */
export function buildReceipt({
	pr,
	headSha,
	startedAt,
	finishedAt,
	status,
	steps,
	otherLivePreReadyRuns,
	prExistenceVerified,
}) {
	return {
		schemaVersion: RECEIPT_SCHEMA_VERSION,
		tool: RECEIPT_TOOL,
		pr: pr === null || pr === undefined ? null : Number(pr),
		headSha,
		startedAt,
		finishedAt,
		durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
		status,
		prExistenceVerified,
		steps: steps.map((s) => ({
			name: s.name,
			outcome: s.outcome,
			...(typeof s.durationMs === 'number' ? { durationMs: s.durationMs } : {}),
		})),
		runEnvironment: {
			// 「pre-ready 以外の負荷は見えていない」ことを名前で明示する (AC5、上記 countOtherLivePreReadyRuns 参照)
			otherLivePreReadyRuns,
			platform: platform(),
			cpuCount: cpus().length,
			freeMemBytesAtEnd: freemem(),
			totalMemBytes: totalmem(),
			nodeVersion: process.version,
		},
	};
}

/**
 * receipt を `tmp/pre-ready-receipts/` に書き出す。
 * @param {string} repoRoot
 * @param {ReturnType<typeof buildReceipt>} receipt
 * @returns {string} 書き出したパス
 */
export function writeReceipt(repoRoot, receipt) {
	const dir = resolve(repoRoot, RECEIPT_DIR);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `pr-${receipt.pr ?? 'none'}-${receipt.headSha.slice(0, 7)}.json`);
	writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');
	return path;
}

/**
 * PR body に貼るための markdown code block を作る。
 *
 * receipt file はローカル (gitignore 下) にしか存在しないため、**PR body に貼られて初めて
 * レビュー側に届く**。そのため stdout にコピペ可能な形で出す。
 *
 * @param {ReturnType<typeof buildReceipt>} receipt
 * @returns {string}
 */
export function formatReceiptBlock(receipt) {
	return ['```json', JSON.stringify(receipt, null, 2), '```'].join('\n');
}

// ---------------------------------------------------------------------------
// gate 側: PR body からの抽出と検証 (AC2 / AC3)
// ---------------------------------------------------------------------------

/**
 * PR body 中の fenced code block から pre-ready receipt を取り出す。
 * @param {string} body
 * @returns {Record<string, unknown> | null}
 */
export function parseReceiptFromBody(body) {
	if (!body) return null;
	const fence = /```(?:json)?\s*\n([\s\S]*?)```/g;
	let m = fence.exec(body);
	while (m !== null) {
		const inner = m[1];
		if (inner.includes(`"${RECEIPT_TOOL}"`)) {
			try {
				const parsed = JSON.parse(inner);
				if (parsed && parsed.tool === RECEIPT_TOOL) return parsed;
			} catch {
				// JSON として壊れている block は receipt ではないものとして次を見る
			}
		}
		m = fence.exec(body);
	}
	return null;
}

/**
 * receipt が「この PR の、この HEAD に対する、全 step PASS の実行」であることを検証する。
 *
 * @param {{
 *   receipt: Record<string, any> | null;
 *   pr: string | number | null;
 *   actualHeadSha: string | null;
 * }} input
 * @returns {{ ok: true } | { ok: false; code: 'missing' | 'pr-mismatch' | 'head-mismatch' | 'status-not-all-pass' | 'schema-unsupported'; message: string }}
 */
export function verifyReceipt({ receipt, pr, actualHeadSha }) {
	if (!receipt) {
		return {
			ok: false,
			code: 'missing',
			message:
				'pre-ready receipt が PR body にありません（3 種の失敗のうち「receipt 不在」）。\n' +
				'  `npm run pre-ready -- --pr <num>` を実行し、出力末尾の receipt ブロックを PR body に貼り付けてください。',
		};
	}
	if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
		return {
			ok: false,
			code: 'schema-unsupported',
			message:
				`receipt の schemaVersion が ${JSON.stringify(receipt.schemaVersion)} で、gate が扱う ${RECEIPT_SCHEMA_VERSION} と異なります。\n` +
				'  pre-ready を再実行して新しい receipt を貼り直してください。',
		};
	}
	if (pr !== null && pr !== undefined && Number(receipt.pr) !== Number(pr)) {
		return {
			ok: false,
			code: 'pr-mismatch',
			message:
				`receipt の PR 番号が一致しません（3 種の失敗のうち「別 PR の receipt」）: receipt=#${receipt.pr} / この PR=#${pr}。\n` +
				'  他 PR の実行ログを流用しています。この PR 番号を指定して pre-ready を実行し直してください (#3994 と同型)。',
		};
	}
	if (actualHeadSha && String(receipt.headSha) !== String(actualHeadSha)) {
		return {
			ok: false,
			code: 'head-mismatch',
			message:
				`receipt の HEAD SHA が PR の実 HEAD と一致しません（3 種の失敗のうち「古い HEAD の receipt」）:\n` +
				`    receipt.headSha = ${receipt.headSha}\n` +
				`    PR の実 HEAD    = ${actualHeadSha}\n` +
				'  receipt 取得後に push した差分は未検証です。最新 HEAD で pre-ready を再実行してください。',
		};
	}
	if (receipt.status !== 'ALL_PASS') {
		return {
			ok: false,
			code: 'status-not-all-pass',
			message:
				`receipt の status が ${JSON.stringify(receipt.status)} で、チェックボックスの「全 Step PASS」宣言と矛盾します。\n` +
				'  skip なしの全 step PASS 実行に対する receipt を貼るか、チェックを外してください。',
		};
	}
	return { ok: true };
}
