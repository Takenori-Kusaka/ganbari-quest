/**
 * scripts/audit/close-leak-report.mjs (#3459 = #3423 AC4)
 *
 * close漏れ取りこぼし検知 report — 「fix は main 反映済だが issue が open のまま」を検出し
 * 一覧 report を出力する補助 job。**auto-close は絶対にしない**（誤爆回避、#3423 選択肢 C 却下と同根拠）。
 *
 * 背景: 0 件化キャンペーン (2026-07-11 監査セッション) で、この class の close漏れが 35+ 件
 * 発見・手動 close された。C 層パターン (#3133 / #3246 / #3088 等) = 実装コミットは main 反映済
 * (conventional commit subject に `fix(scope): #N ...` の形で issue 参照) だが、develop 二層 +
 * squash merge で closing keyword が main に到達せず GitHub auto-close が不発火 → open のまま残る。
 * 止血の主機構は #3423 AC2 (統合 PR の Closes 集約) + #3458 AC1 (per-PR gate)。本 script は
 * 既存 backlog の棚卸し (掃除用 report) を自動化する。
 *
 * 検出ヒューリスティック:
 *   open issue 一覧 (gh issue list) × main コミット log (git log --since) の突合。
 *   コミット subject の issue 参照 (`#N` / `＃N`、squash PR 番号 `(#N)` 末尾は除外) と
 *   コミット body の closing keyword 行 (`Closes #N` 等、#3444 の行頭アンカー方式と同型) を採用。
 *   誤検知 (EPIC / 進行中 workstream / 部分対応 PR の参照) は **report に含めて人間が判断**する
 *   (auto-close しないため false positive 許容。labels 列 + 該当コミット列で判断材料を併記)。
 *
 * GH API / git 呼び出し (副作用) と判定純関数を分離。純関数は
 * tests/unit/audit/close-leak-report.test.ts で unit test 済。
 *
 * 使用例:
 *   node scripts/audit/close-leak-report.mjs                       # markdown report を stdout へ
 *   node scripts/audit/close-leak-report.mjs --since "30 days ago" # 走査期間変更
 *   node scripts/audit/close-leak-report.mjs --json                # JSON 出力 (機械処理用)
 *
 * CI: .github/workflows/close-leak-report.yml (週次 cron + workflow_dispatch) が実行し
 *     GITHUB_STEP_SUMMARY へ report を書き込む。exit code は常に 0 (report only、gate ではない)。
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 既定の走査期間 (git approxidate)。週次 cron 運用で直近の close漏れを拾いつつ noise を抑える */
export const DEFAULT_SINCE = '90 days ago';

/** 既定の走査対象 ref (main 反映済判定の基準) */
export const DEFAULT_REF = 'origin/main';

/** git log の record / field separator (RS / US 制御文字、コミット本文と衝突しない) */
const RECORD_SEP = '\u001e';
const FIELD_SEP = '\u001f';

/** merge commit subject (`Merge pull request #N` / `Merge branch ...`) — #N は PR 番号のため subject 走査から除外 */
const MERGE_SUBJECT_RE = /^Merge (?:pull request #\d+|branch\b|remote-tracking branch\b)/;

/** subject 末尾の squash merge PR 番号 `(#N)` — issue 参照ではないため strip */
const TRAILING_PR_NUMBER_RE = /\s*\(#\d+\)\s*$/;

/** issue 参照 (半角 `#` / 全角 `＃`、#3444 の under-close 教訓と同型) */
const ISSUE_REF_RE = /[#＃](\d+)/g;

/**
 * body 内の行頭 closing keyword 行のみを拾う正規表現 (#3444 `extractClosedIssues` と同型の
 * 行頭アンカー方式)。body 全参照を拾うと `関連: #N` 等の部分対応参照で noise が増えるため、
 * closing keyword 宣言のみを採用する。
 */
const CLOSING_KEYWORD_LINE_RE =
	/^[ \t]*(?:[-*+][ \t]+)?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[ \t]*:?[ \t]*[#＃](\d+)/gim;

/**
 * `git log --format=%H%x1f%ad%x1f%s%x1f%b%x1e` の raw 出力をコミット record 配列に parse する純関数。
 *
 * @param {string} raw
 * @returns {Array<{ sha: string; date: string; subject: string; body: string }>}
 */
export function parseGitLog(raw) {
	if (typeof raw !== 'string' || raw.trim() === '') return [];
	const records = [];
	for (const chunk of raw.split(RECORD_SEP)) {
		const trimmed = chunk.replace(/^\s+/, '');
		if (trimmed === '') continue;
		const [sha, date, subject, body] = trimmed.split(FIELD_SEP);
		if (!sha || !subject) continue;
		records.push({
			sha,
			date: date ?? '',
			subject: subject.trim(),
			body: (body ?? '').trim(),
		});
	}
	return records;
}

/**
 * 1 コミットから issue 参照番号を抽出する純関数。
 *
 * - subject: 全 `#N` / `＃N` を採用。ただし merge commit subject は PR 番号のため全体を skip、
 *   subject 末尾の squash PR 番号 `(#N)` は strip する。
 * - body: 行頭 closing keyword 行 (`Closes #N` 等) のみ採用 (`関連: #N` は拾わない)。
 *
 * PR 番号の誤混入は後段の「open issue 番号との突合」で自然に落ちる (同一連番空間のため
 * PR 番号が open issue 番号と一致することはない) が、subject 側でも除外して精度を上げる。
 *
 * @param {{ subject?: string; body?: string }} commit
 * @returns {number[]} 昇順・重複排除した issue 番号
 */
export function extractCommitIssueRefs(commit) {
	const set = new Set();
	const subject = typeof commit?.subject === 'string' ? commit.subject : '';
	const body = typeof commit?.body === 'string' ? commit.body : '';

	if (subject !== '' && !MERGE_SUBJECT_RE.test(subject)) {
		const stripped = subject.replace(TRAILING_PR_NUMBER_RE, '');
		ISSUE_REF_RE.lastIndex = 0;
		for (const m of stripped.matchAll(ISSUE_REF_RE)) {
			const n = Number(m[1]);
			if (Number.isInteger(n) && n > 0) set.add(n);
		}
	}

	CLOSING_KEYWORD_LINE_RE.lastIndex = 0;
	for (const m of body.matchAll(CLOSING_KEYWORD_LINE_RE)) {
		const n = Number(m[1]);
		if (Number.isInteger(n) && n > 0) set.add(n);
	}

	return [...set].sort((a, b) => a - b);
}

/**
 * label が epic / tracker 系か (人間判断の材料として flag 付けするのみ、除外はしない)。
 *
 * @param {Array<string | { name?: string }>} labels
 * @returns {boolean}
 */
export function isEpicLike(labels) {
	return (labels ?? []).some((l) => {
		const name = typeof l === 'string' ? l : (l?.name ?? '');
		return /epic|tracker/i.test(name);
	});
}

/**
 * open issue 一覧 × main コミット群を突合し close漏れ候補を返す純関数。
 *
 * @param {{
 *   openIssues: Array<{ number: number; title?: string; labels?: Array<string | { name?: string }> }>;
 *   commits: Array<{ sha: string; date: string; subject: string; body?: string }>;
 * }} input
 * @returns {Array<{
 *   number: number;
 *   title: string;
 *   labels: string[];
 *   epicLike: boolean;
 *   commits: Array<{ sha: string; date: string; subject: string }>;
 * }>} issue 番号昇順。main 反映コミットが 1 件も無い open issue は含まれない
 */
export function detectCloseLeaks({ openIssues, commits }) {
	/** @type {Map<number, Array<{ sha: string; date: string; subject: string }>>} */
	const byIssue = new Map();
	for (const c of commits ?? []) {
		for (const n of extractCommitIssueRefs(c)) {
			if (!byIssue.has(n)) byIssue.set(n, []);
			byIssue.get(n)?.push({ sha: c.sha, date: c.date, subject: c.subject });
		}
	}

	const leaks = [];
	for (const issue of openIssues ?? []) {
		const n = Number(issue?.number);
		if (!Number.isInteger(n) || n <= 0) continue;
		const matched = byIssue.get(n);
		if (!matched || matched.length === 0) continue;
		const labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : (l?.name ?? '')));
		leaks.push({
			number: n,
			title: issue.title ?? '',
			labels,
			epicLike: isEpicLike(issue.labels ?? []),
			commits: matched,
		});
	}
	return leaks.sort((a, b) => a.number - b.number);
}

/**
 * markdown table cell escape (pipe / 改行)
 * @param {unknown} s
 * @returns {string}
 */
function escapeCell(s) {
	return String(s ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ');
}

/**
 * close漏れ候補の markdown report を組み立てる純関数。
 *
 * @param {ReturnType<typeof detectCloseLeaks>} leaks
 * @param {{ since?: string; ref?: string; totalOpen?: number; totalCommits?: number }} [meta]
 * @returns {string}
 */
export function buildCloseLeakReport(leaks, meta = {}) {
	const since = meta.since ?? DEFAULT_SINCE;
	const ref = meta.ref ?? DEFAULT_REF;
	const lines = [
		'## close漏れ取りこぼし検知 report (#3459 / #3423 AC4)',
		'',
		`- 走査対象: \`${ref}\` の直近コミット (since: ${since})${typeof meta.totalCommits === 'number' ? ` ${meta.totalCommits} 件` : ''}`,
		`- open issue: ${typeof meta.totalOpen === 'number' ? `${meta.totalOpen} 件` : '(件数不明)'}`,
		`- **検出: ${leaks.length} 件** (main 反映済コミットが issue 番号を参照しているのに open のまま)`,
		'',
		'> **auto-close はしません**。本 report は人間が一覧を見て手動 close (AC gate 経由) するための',
		'> 棚卸し材料です。EPIC / 進行中 workstream / 部分対応 PR の参照は false positive のため、',
		'> labels 列と該当コミットを見て判断してください。',
		'',
	];

	if (leaks.length === 0) {
		lines.push('close漏れ候補は検出されませんでした。');
		lines.push('');
		return lines.join('\n');
	}

	lines.push('| Issue | タイトル | labels | main 反映コミット (該当分) |');
	lines.push('|---|---|---|---|');
	for (const leak of leaks) {
		const flag = leak.epicLike ? ' ⚠️epic/tracker' : '';
		const commits = leak.commits
			.map((c) => `\`${c.sha.slice(0, 8)}\` (${c.date}) ${escapeCell(c.subject)}`)
			.join('<br>');
		lines.push(
			`| #${leak.number} | ${escapeCell(leak.title)} | ${escapeCell(leak.labels.join(', '))}${flag} | ${commits} |`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

/**
 * CLI 引数 parse (純関数)。
 *
 * @param {string[]} argv
 * @returns {{ since: string; ref: string; limit: number; json: boolean }}
 */
export function parseArgs(argv) {
	const out = { since: DEFAULT_SINCE, ref: DEFAULT_REF, limit: 500, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = argv[i + 1];
		if (a === '--since' && next) {
			out.since = next;
			i++;
		} else if (a === '--ref' && next) {
			out.ref = next;
			i++;
		} else if (a === '--limit' && next) {
			out.limit = Number(next) || out.limit;
			i++;
		} else if (a === '--json') {
			out.json = true;
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// 以下は副作用層 (gh / git 呼び出し + 出力)。純関数の unit test 対象外。
// ---------------------------------------------------------------------------

/**
 * gh CLI で open issue 一覧を取得する
 * @param {number} limit
 * @returns {Array<{ number: number; title?: string; labels?: Array<{ name?: string }> }>}
 */
function fetchOpenIssues(limit) {
	const raw = execFileSync(
		'gh',
		['issue', 'list', '--state', 'open', '--limit', String(limit), '--json', 'number,title,labels'],
		{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
	);
	return JSON.parse(raw);
}

/**
 * git log を RS/US 区切り raw で取得する
 * @param {string} ref
 * @param {string} since
 * @returns {string}
 */
function fetchGitLogRaw(ref, since) {
	return execFileSync(
		'git',
		[
			'log',
			ref,
			`--since=${since}`,
			'--date=short',
			`--format=%H${FIELD_SEP}%ad${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`,
		],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const openIssues = fetchOpenIssues(args.limit);
	const commits = parseGitLog(fetchGitLogRaw(args.ref, args.since));
	const leaks = detectCloseLeaks({ openIssues, commits });

	if (args.json) {
		console.log(JSON.stringify({ since: args.since, ref: args.ref, leaks }, null, 2));
	} else {
		const report = buildCloseLeakReport(leaks, {
			since: args.since,
			ref: args.ref,
			totalOpen: openIssues.length,
			totalCommits: commits.length,
		});
		console.log(report);
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
		}
	}
	// report only — 検出 0 件でも N 件でも exit 0 (gate ではない、AC2)
	process.exit(0);
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
