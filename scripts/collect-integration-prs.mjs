#!/usr/bin/env node
/**
 * scripts/collect-integration-prs.mjs — Issue #4053
 *
 * develop → main 統合 PR の「含有候補 PR」を **main..develop の merge 履歴から直接** 収集し、
 * 生成される「含有 PR 一覧」の件数を git 側の実数と突き合わせて自己検証する。
 *
 * ## なぜ必要か (#4053)
 *
 * 旧実装は `.github/workflows/integration-pr.yml` の shell に直書きされており、
 * 候補 PR を **時刻 anchor 以降に develop へ merge された PR** として絞っていた:
 *
 * ```yaml
 * SINCE_ISO=$(git show -s --format=%cI "$MAIN_HEAD")   # ローカルオフセット形 (+09:00)
 * gh pr list ... --jq "[.[] | select(.mergedAt >= \"$SINCE_ISO\")]"   # mergedAt は Z 形
 * ```
 *
 * ここに独立した欠陥が 2 つあった:
 *
 * 1. **jq の `>=` は文字列比較**であり、`2026-07-26T08:01:03+09:00` と `2026-07-26T00:36:09Z`
 *    のように **TZ 表記が混在すると辞書順が時刻順にならない**。同じ ISO8601 でも表記系が違えば
 *    比較結果は時刻の前後と一致しない (実測: #3951 が「anchor より後」なのに false で脱落)。
 * 2. **anchor が「前回統合 merge」ではなく main HEAD の commit 日時**だった。main に hotfix が
 *    直接 merge されるたびに anchor が前進し、その間に develop へ入った PR が構造的に脱落する
 *    (実測: main HEAD = hotfix #3947、実際の前回統合は 2 日前の 62236700)。
 *
 * 結果、main..develop に merged PR が 21 本ある状態で統合 PR 本文の含有一覧は 3 本しか出ず、
 * **main リリースの監査証跡 (#2950 AC4) と `Closes` 集約 (#3423) が同時に壊れていた**。
 *
 * ## 本 script の方針 — 時刻比較に依存しない
 *
 * 候補集合を **`git log --first-parent <base>..<head>` の merge 履歴**から取る。
 * 「main に未取込の commit」は git が構造として持っている事実であり、時計・TZ・anchor に一切
 * 依存しない。時刻 (anchor) は **統合対象期間の表示と drift 日数**にのみ使い、その比較も
 * epoch 正規化 (`toEpochMs`) 経由で行う (文字列比較しない)。
 *
 * anchor 自体も main HEAD ではなく **main 上の直近の統合 merge** を探す
 * (`findLastIntegrationAnchor`)。hotfix が main に直接入っても anchor は前進しない。
 *
 * ## 自己検証 (silent に少ない一覧を出さない、#4053 AC5)
 *
 * git 側の実数 (`main..develop` の merged PR 数) と、PR メタデータ側の
 * contained + excluded の内訳を突き合わせ、一致しなければ **非 0 で終了**する。
 * 突合式: `contained + excluded == total (main..develop の merged PR 数)`。
 * gh から取得できなかった PR 番号 (missing) が 1 件でもあれば同様に fail する。
 *
 * ## Usage
 *
 *   node scripts/collect-integration-prs.mjs \
 *     --base origin/main --head origin/develop \
 *     --out /tmp/develop-merged.json --reconcile-out /tmp/integration-reconcile.json
 *
 * offline / test 用に外部コマンドを差し替えられる:
 *   --first-parent-log <path>   git log --first-parent の出力 (`%H|%cI|%s`) を file から読む
 *   --anchor-log <path>         base 側 first-parent log を file から読む
 *   --prs <path>                PR メタデータ配列 (gh --json 形式) を file から読む
 *
 * exit: 0 = 突合一致 / 1 = 突合不一致 (脱落あり) / 2 = 引数不正 / 3 = 入力読込・外部コマンド失敗
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isMain as isMainModule } from './lib/is-main.mjs';

/** git log のフォーマット (`%H|%cI|%s`)。sha / committer ISO / subject。 */
export const GIT_LOG_FORMAT = '%H|%cI|%s';

/**
 * `git log --format=%H|%cI|%s` の出力を entry 配列へ変換する純粋関数。
 * subject 自体に `|` が含まれても壊れないよう、先頭 2 つの `|` のみで分割する。
 *
 * @param {string} text
 * @returns {Array<{ sha: string; committedIso: string; subject: string }>}
 */
export function parseFirstParentLog(text) {
	/** @type {Array<{ sha: string; committedIso: string; subject: string }>} */
	const out = [];
	for (const raw of String(text ?? '').split('\n')) {
		const line = raw.trim();
		if (line === '') continue;
		const i1 = line.indexOf('|');
		if (i1 === -1) continue;
		const i2 = line.indexOf('|', i1 + 1);
		if (i2 === -1) continue;
		out.push({
			sha: line.slice(0, i1),
			committedIso: line.slice(i1 + 1, i2),
			subject: line.slice(i2 + 1),
		});
	}
	return out;
}

/**
 * commit subject から「その commit が取り込んだ PR 番号」を取り出す純粋関数。
 *
 * 対応する 2 形式 (本リポジトリの develop の実履歴で両方出現する):
 *   - merge commit: `Merge pull request #3949 from Takenori-Kusaka/back-merge/...`
 *   - squash merge: `fix(db): #3948 … (#3951)` — **末尾**の `(#N)` が PR 番号
 *
 * squash 形は subject 中に Issue 番号 (`#3948`) も現れるため、**末尾の `(#N)` のみ**を採る。
 * どちらにも当たらない subject (直 push commit 等) は null を返す。
 *
 * @param {string} subject
 * @returns {number | null}
 */
export function extractMergedPrNumber(subject) {
	const s = String(subject ?? '').trim();
	const mergeMatch = /^Merge pull request #(\d+) from /.exec(s);
	if (mergeMatch) return Number(mergeMatch[1]);
	const squashMatch = /\(#(\d+)\)$/.exec(s);
	if (squashMatch) return Number(squashMatch[1]);
	return null;
}

/**
 * first-parent log entry 配列から PR 番号を昇順・重複排除で取り出す純粋関数。
 *
 * @param {Array<{ subject: string }>} entries
 * @returns {number[]}
 */
export function extractMergedPrNumbers(entries) {
	const set = new Set();
	for (const e of entries ?? []) {
		const n = extractMergedPrNumber(e?.subject ?? '');
		if (n !== null) set.add(n);
	}
	return [...set].sort((a, b) => a - b);
}

/**
 * commit subject が「develop → main の統合 merge」かを判定する純粋関数 (#4053 AC2)。
 *
 * 統合 PR は head=develop で発行されるため、main 側には次のいずれかの形で現れる:
 *   - `Merge pull request #3995 from Takenori-Kusaka/develop` (merge commit 形)
 *   - `Merge branch 'develop'` (ローカル merge 形)
 *   - `release: [第17回] develop→main 統合 (2026-07-24) … (#3931)` (squash 形、実履歴)
 *   - `[統合] develop → main (2026-07-26)` (integration-pr.yml が付ける PR title 由来)
 *
 * hotfix の main 直 merge (`Merge pull request #3947 from Takenori-Kusaka/fix/3946-…` や
 * `fix(deploy): 第16回リリース完遂 … (#3885)`) は **いずれにも当たらない**ため anchor に
 * ならない。これが「hotfix で anchor が前進する」旧欠陥の直接の対処である。
 *
 * @param {string} subject
 * @returns {boolean}
 */
export function isIntegrationMergeSubject(subject) {
	const s = String(subject ?? '').trim();
	if (/^Merge pull request #\d+ from \S+\/develop$/.test(s)) return true;
	if (/^Merge branch '?develop'?/.test(s)) return true;
	// `develop→main` / `develop → main` / `develop->main` を含む統合 commit (release: / [統合] 形)。
	if (/develop\s*(?:→|->|=>)\s*main/.test(s)) return true;
	return false;
}

/**
 * base 側 (main) の first-parent log から「直近の統合 merge」を探す純粋関数 (#4053 AC2)。
 * 見つからなければ null (呼び出し側が warning 付きで HEAD へ fallback する)。
 *
 * @param {Array<{ sha: string; committedIso: string; subject: string }>} entries 新しい順
 * @returns {{ sha: string; committedIso: string; subject: string } | null}
 */
export function findLastIntegrationAnchor(entries) {
	for (const e of entries ?? []) {
		if (isIntegrationMergeSubject(e?.subject ?? '')) return e;
	}
	return null;
}

/**
 * ISO8601 文字列を epoch ミリ秒へ正規化する純粋関数 (#4053 AC1)。
 *
 * `2026-07-26T08:01:03+09:00` (ローカルオフセット形) と `2026-07-25T23:01:03Z` (Z 形) は
 * **同一時刻**であり、本関数を通すと同じ値になる。文字列比較 (`>=`) はこの同一性を壊す。
 *
 * @param {string} iso
 * @returns {number} epoch ms。解釈不能なら NaN
 */
export function toEpochMs(iso) {
	const ms = Date.parse(String(iso ?? ''));
	return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * 2 つの ISO8601 を **時刻として** 比較する純粋関数 (#4053 AC1)。TZ 表記の違いに影響されない。
 *
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1} a<b: -1 / a==b: 0 / a>b: 1
 * @throws {Error} どちらかが解釈不能な場合 (silent に false を返さない)
 */
export function compareIsoInstant(a, b) {
	const ea = toEpochMs(a);
	const eb = toEpochMs(b);
	if (Number.isNaN(ea) || Number.isNaN(eb)) {
		throw new Error(`[collect-integration-prs] ISO8601 として解釈できない値: a=${a} / b=${b}`);
	}
	if (ea < eb) return -1;
	if (ea > eb) return 1;
	return 0;
}

/**
 * `a >= b` を **時刻として** 判定する純粋関数 (#4053 AC1)。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function isAtOrAfterInstant(a, b) {
	return compareIsoInstant(a, b) >= 0;
}

/**
 * anchor からの経過日数 (drift) を epoch 正規化して求める純粋関数。
 * TZ 表記が混在した 2 値 (anchor=`+09:00` 形 / now=`Z` 形) でも正しく計算される。
 *
 * @param {string} anchorIso
 * @param {string} nowIso
 * @returns {number} 経過日数 (切り捨て、負にはしない)
 */
export function computeDriftDays(anchorIso, nowIso) {
	const diff = toEpochMs(nowIso) - toEpochMs(anchorIso);
	if (!Number.isFinite(diff)) return 0;
	return Math.max(0, Math.floor(diff / 86_400_000));
}

/**
 * PR の labels (string[] / {name}[]) を string[] へ正規化する純粋関数。
 *
 * @param {Array<string | { name?: string }> | undefined} labels
 * @returns {string[]}
 */
function normalizeLabels(labels) {
	return (labels ?? []).map((l) => (typeof l === 'string' ? l : (l?.name ?? '')));
}

/**
 * 含有一覧から除外すべき PR かを判定し、除外理由を返す純粋関数。
 *
 * 判定規則は `scripts/integration-pr-body.mjs` の `classifyForContainedList()` と同一
 * (head=develop = 統合 PR 自身 / head=back-merge\* or label:back-merge = back-merge)。
 * 本 file は **除外理由の文字列**を突合レポートへ出すために理由付きで再判定する
 * (#4053 AC5: 除外した PR 番号 + 除外理由を出力に含める)。分類規則そのものは変更しない (AC7)。
 *
 * @param {{ headRefName?: string; labels?: Array<string|{name:string}> }} pr
 * @returns {string | null} 除外理由。含有対象なら null
 */
export function excludeReason(pr) {
	const head = (pr?.headRefName ?? '').trim();
	const labels = new Set(normalizeLabels(pr?.labels));
	if (head === 'develop') return '統合 PR 自身 (head=develop)';
	if (head.startsWith('back-merge/')) return `back-merge PR (head=${head})`;
	if (labels.has('back-merge')) return 'back-merge PR (label:back-merge)';
	return null;
}

/**
 * git 側の実数と PR メタデータ側の内訳を突き合わせる純粋関数 (#4053 AC5)。
 *
 * - `contained` … 含有 PR 一覧に出るべき PR (番号昇順)
 * - `excluded`  … back-merge / 統合 PR 自身 (番号 + 理由)
 * - `missing`   … git log にあるのに PR メタデータが取れなかった番号 (= silent 脱落の兆候)
 * - `ok`        … `contained + excluded === total` かつ `missing` が空
 *
 * @param {{ mergedPrNumbers: number[]; prs: Array<{ number: number; headRefName?: string; labels?: Array<string|{name:string}> }> }} input
 * @returns {{ total: number; contained: number[]; excluded: Array<{ number: number; reason: string }>; missing: number[]; ok: boolean }}
 */
export function reconcileCandidates({ mergedPrNumbers, prs }) {
	const numbers = [...new Set(mergedPrNumbers ?? [])].sort((a, b) => a - b);
	const byNumber = new Map((prs ?? []).map((p) => [Number(p?.number), p]));

	/** @type {number[]} */
	const contained = [];
	/** @type {Array<{ number: number; reason: string }>} */
	const excluded = [];
	/** @type {number[]} */
	const missing = [];

	for (const n of numbers) {
		const pr = byNumber.get(n);
		if (!pr) {
			missing.push(n);
			continue;
		}
		const reason = excludeReason(pr);
		if (reason === null) contained.push(n);
		else excluded.push({ number: n, reason });
	}

	const ok = missing.length === 0 && contained.length + excluded.length === numbers.length;
	return { total: numbers.length, contained, excluded, missing, ok };
}

/**
 * 突合レポートを人間可読な複数行文字列にする純粋関数 (#4053 AC5: 件数 + 除外理由を出力)。
 *
 * @param {{ total: number; contained: number[]; excluded: Array<{ number: number; reason: string }>; missing: number[]; ok: boolean }} r
 * @returns {string}
 */
export function formatReconcileReport(r) {
	const lines = [];
	lines.push(
		`突合式: ${r.contained.length} (含有) + ${r.excluded.length} (除外) = ${
			r.contained.length + r.excluded.length
		} / ${r.total} (main..develop の merged PR 数)`,
	);
	lines.push(`含有 PR: ${r.contained.map((n) => `#${n}`).join(' ') || '(なし)'}`);
	for (const e of r.excluded) lines.push(`除外 #${e.number}: ${e.reason}`);
	if (r.missing.length > 0) {
		lines.push(
			`未解決 PR (git log にあるが PR メタデータを取得できない): ${r.missing
				.map((n) => `#${n}`)
				.join(' ')}`,
		);
	}
	lines.push(r.ok ? 'RESULT: OK (突合一致)' : 'RESULT: MISMATCH (含有一覧が実差分と一致しない)');
	return lines.join('\n');
}

/**
 * 簡易 argv パーサ (判定 logic は持たない)。
 *
 * @param {string[]} argv
 * @returns {Record<string,string>}
 */
export function parseArgs(argv) {
	/** @type {Record<string,string>} */
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === undefined || !arg.startsWith('--')) continue;
		const eq = arg.indexOf('=');
		if (eq !== -1) {
			out[arg.slice(2, eq)] = arg.slice(eq + 1);
		} else {
			out[arg.slice(2)] = argv[i + 1] ?? '';
			i += 1;
		}
	}
	return out;
}

/**
 * 外部コマンドを実行し stdout を返す (CLI 専用、純粋関数ではない)。
 *
 * @param {string} file
 * @param {string[]} args
 * @returns {string}
 */
function run(file, args) {
	return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * @typedef {{ number: number; title?: string; headRefName?: string; labels?: Array<string|{name:string}>; mergedAt?: string; body?: string }} PrMeta
 */

/**
 * PR メタデータを gh から取得する (CLI 専用)。
 * base=develop の merged PR を一括取得し、取りこぼした番号のみ個別 fetch する。
 *
 * @param {number[]} numbers
 * @returns {PrMeta[]}
 */
function fetchPrsViaGh(numbers) {
	const fields = 'number,title,headRefName,labels,mergedAt,body';
	/** @type {Map<number, PrMeta>} */
	const found = new Map();
	const bulk = JSON.parse(
		run('gh', [
			'pr',
			'list',
			'--base',
			'develop',
			'--state',
			'merged',
			'--limit',
			'300',
			'--json',
			fields,
		]),
	);
	const wanted = new Set(numbers);
	for (const pr of bulk) {
		if (wanted.has(Number(pr.number))) found.set(Number(pr.number), pr);
	}
	// 一括取得の窓 (300 件) から漏れた PR は個別に取得する (silent 脱落を作らない)。
	for (const n of numbers) {
		if (found.has(n)) continue;
		try {
			found.set(n, JSON.parse(run('gh', ['pr', 'view', String(n), '--json', fields])));
		} catch {
			// 取得失敗は missing として reconcile が fail させる (ここでは握りつぶさない)。
		}
	}
	return numbers.map((n) => found.get(n)).filter((p) => p !== undefined);
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const base = args.base || 'origin/main';
	const head = args.head || 'origin/develop';
	const outPath = args.out;
	if (!outPath) {
		console.error(
			'[collect-integration-prs] Usage: node scripts/collect-integration-prs.mjs --base origin/main --head origin/develop --out <prs.json> [--reconcile-out <path>] [--first-parent-log <path>] [--anchor-log <path>] [--prs <path>]',
		);
		process.exit(2);
	}

	try {
		// 1. main..develop の first-parent merge 履歴から含有候補 PR 番号を取る (時刻比較なし)。
		const rangeLogText = args['first-parent-log']
			? readFileSync(args['first-parent-log'], 'utf8')
			: run('git', ['log', '--first-parent', `--format=${GIT_LOG_FORMAT}`, `${base}..${head}`]);
		const rangeEntries = parseFirstParentLog(rangeLogText);
		const mergedPrNumbers = extractMergedPrNumbers(rangeEntries);

		// 2. anchor = base 上の直近の統合 merge (hotfix では前進しない、AC2)。表示・drift 用。
		const anchorLogText = args['anchor-log']
			? readFileSync(args['anchor-log'], 'utf8')
			: run('git', ['log', '--first-parent', `--format=${GIT_LOG_FORMAT}`, base]);
		const anchorEntries = parseFirstParentLog(anchorLogText);
		const anchor = findLastIntegrationAnchor(anchorEntries);
		if (anchor === null) {
			console.error(
				`[collect-integration-prs] WARNING: ${base} の first-parent 履歴に統合 merge が見つかりません。anchor を ${base} HEAD へ fallback します (統合対象期間 / drift 表示のみに影響)。`,
			);
		}
		const anchorEntry = anchor ?? anchorEntries[0] ?? null;
		const anchorIso = anchorEntry?.committedIso ?? '';
		const nowIso = new Date().toISOString();
		// 時刻比較は必ず epoch 正規化を通す (文字列比較しない、AC1)。
		const driftDays = anchorIso ? computeDriftDays(anchorIso, nowIso) : 0;

		// 3. PR メタデータを取得し、git 側の実数と突き合わせる。
		/** @type {PrMeta[]} */
		const prs = args.prs
			? JSON.parse(readFileSync(args.prs, 'utf8'))
			: fetchPrsViaGh(mergedPrNumbers);
		const result = reconcileCandidates({ mergedPrNumbers, prs });

		// 4. 出力 (含有候補の PR メタデータ配列 = 本文生成の入力)。
		const byNumber = new Map(prs.map((p) => [Number(p.number), p]));
		const selected = mergedPrNumbers.map((n) => byNumber.get(n)).filter((p) => p !== undefined);
		writeFileSync(outPath, `${JSON.stringify(selected, null, 2)}\n`, 'utf8');

		const reconcile = {
			base,
			head,
			anchorSha: anchorEntry?.sha ?? '',
			anchorSubject: anchorEntry?.subject ?? '',
			anchorIso,
			anchorIsIntegrationMerge: anchor !== null,
			sinceDate: anchorIso ? anchorIso.slice(0, 10) : '',
			untilDate: nowIso.slice(0, 10),
			driftDays,
			expectedContained: result.contained.length,
			...result,
		};
		if (args['reconcile-out']) {
			writeFileSync(args['reconcile-out'], `${JSON.stringify(reconcile, null, 2)}\n`, 'utf8');
		}

		console.log(`anchor: ${reconcile.anchorSha} ${anchorIso} ${reconcile.anchorSubject}`);
		console.log(`anchor は統合 merge か: ${anchor !== null ? 'yes' : 'no (HEAD fallback)'}`);
		console.log(`drift 日数: ${driftDays}`);
		console.log(formatReconcileReport(result));

		process.exit(result.ok ? 0 : 1);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[collect-integration-prs] 実行失敗: ${message}`);
		process.exit(3);
	}
}
