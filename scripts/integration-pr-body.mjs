#!/usr/bin/env node
/**
 * scripts/integration-pr-body.mjs — Issue #2871 (Phase B/B-3、親 #2949 / EPIC #2861)
 *
 * develop → main 統合 PR の本文を **純粋関数 SSOT** として生成する。
 * `.github/workflows/integration-pr.yml`（release PR パターンの薄い orchestrator）が
 * 本 script を呼ぶ。本文生成 logic は全て本 file に集約し yml に分散させない（hotfix-back-merge.mjs と同型）。
 *
 * 背景 (#2949 / branch-strategy.md §2):
 *   `develop → main` の統合 PR を手動で毎日作る運用は持続しない（ソロ PO の負荷 / 作り忘れ /
 *   develop⇔main drift 蓄積）。さらに統合 PR 本文（含有 PR 一覧・サマリ）を手書きすると
 *   ADR-0056 の散文 self-report 退化を招く。release-please の Release PR パターン
 *   （PR を常時最新に保ち merge 時に統合）を develop→main に適用し、含有 PR 一覧を
 *   develop の merge 履歴から機械生成する。
 *
 * 責務分担:
 *   - 本 file = 統合 PR **本文の組み立て**（template 骨格注入 + 含有 PR 一覧表生成 + 統合サマリ）。
 *     副作用なし（PR 発行・gh API は workflow 側）。
 *   - workflow (.github/workflows/integration-pr.yml) = develop の merge 履歴取得（gh API）+
 *     diff 有無判定 + PR upsert（発行・本文更新）+ branch 操作。
 *   - `.github/INTEGRATION_PR_TEMPLATE.md` (B-1 #2950) = section SSOT。本 script はこれを骨格として読み込み
 *     「含有 PR 一覧」「統合サマリ」section の placeholder を実データで差し替える。
 *
 * 核心 (純粋関数):
 *
 *   1. buildContainedPrTable(prs)
 *      → markdown 表文字列
 *      develop に merge された feature/fix PR の配列から「含有 PR 一覧」の 4 列表を生成する。
 *      back-merge PR / 統合 PR 自身は含有対象から除外する（classifyForContainedList で判定）。
 *
 *   2. buildBackMergeStatus({ backMergePrs, driftDays })
 *      → back-merge / drift 状態 section のデータ行（B-5 contract）
 *
 *   3. renderIntegrationPrBody({ template, prs, developHead, sinceDate, untilDate, backMergePrs, driftDays })
 *      → 統合 PR 本文全文（template の placeholder を差し替えた markdown）
 *
 *   「マージ判定エビデンス表」（§3）/「監査 run 結果リンク」（§4）/「NG 0 件宣言」（§5）は
 *   本 script では差し替えない。これらは audit-manager run が CI artifact（SARIF 集約 + カバレッジ
 *   gap map、#2874）を入力に記入する section であり、template 本体（B-4 #2876 で実エビデンス基準 +
 *   SARIF 2.1.0 + in-toto attestation 参照に更新済み）をそのまま骨格として保持する。
 *
 * Usage (CLI、workflow から呼ぶ):
 *   cat prs.json | node scripts/integration-pr-body.mjs \
 *     --template .github/INTEGRATION_PR_TEMPLATE.md \
 *     --develop-head abc1234 --since 2026-06-10 --until 2026-06-16 \
 *     --back-merge-prs back-merge.json --drift-days 3
 *   → stdout に統合 PR 本文全文
 *
 * exit: 0 = 生成成功 / 2 = 引数不足 / 3 = template 読込失敗
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * PR の labels（string[] or {name}[]）を string[] に正規化する純粋関数。
 *
 * @param {Array<string | { name?: string }> | undefined} labels
 * @returns {string[]}
 */
function normalizeLabels(labels) {
	return (labels ?? []).map((l) => (typeof l === 'string' ? l : (l?.name ?? '')));
}

/**
 * 統合 PR の「含有 PR 一覧」に含めるべき PR かを判定する純粋関数。
 * back-merge PR (head=back-merge/*) と 統合 PR 自身 (head=develop) は除外する
 * （統合 PR は develop の差分そのものなので、過去の統合 PR / back-merge を二重列挙しない）。
 *
 * @param {{ headRefName?: string; labels?: Array<string|{name:string}> }} pr
 * @returns {'contained' | 'excluded'}
 */
export function classifyForContainedList(pr) {
	const head = (pr.headRefName ?? '').trim();
	const labels = new Set(normalizeLabels(pr.labels));
	// 統合 PR 自身（develop → main）は含有対象外。
	if (head === 'develop') return 'excluded';
	// back-merge PR（main → develop の取込）は drift 状態として §6 で扱うため含有一覧には出さない。
	if (head.startsWith('back-merge/') || labels.has('back-merge')) return 'excluded';
	return 'contained';
}

/**
 * PR の type label（type:feat 等）を抽出する純粋関数。複数あれば最初の type:* を返す。
 *
 * @param {{ labels?: Array<string|{name:string}> }} pr
 * @returns {string} 例: 'type:feat'。無ければ '—'
 */
export function extractTypeLabel(pr) {
	const labels = normalizeLabels(pr.labels);
	const typeLabel = labels.find((l) => l.startsWith('type:'));
	return typeLabel ?? '—';
}

/**
 * PR の area label（area:admin 等）を抽出する純粋関数。複数あれば '/' 連結。
 *
 * @param {{ labels?: Array<string|{name:string}> }} pr
 * @returns {string} 例: 'area:admin'。無ければ '—'
 */
export function extractAreaLabel(pr) {
	const labels = normalizeLabels(pr.labels);
	const areas = labels.filter((l) => l.startsWith('area:'));
	return areas.length > 0 ? areas.join(' / ') : '—';
}

/**
 * markdown 表セル用に文字列を安全化する純粋関数（pipe をエスケープ、改行を除去）。
 *
 * @param {string} s
 * @returns {string}
 */
export function escapeCell(s) {
	return String(s ?? '')
		.replace(/\r?\n/g, ' ')
		.replace(/\\/g, '\\\\')
		.replace(/\|/g, '\\|')
		.trim();
}

/**
 * 含有 PR 一覧の 4 列 markdown 表を生成する純粋関数（#2871 AC3）。
 * back-merge / 統合 PR 自身を除外し、PR 番号昇順で列挙する。
 *
 * @param {Array<{ number: number; title: string; headRefName?: string; labels?: Array<string|{name:string}> }>} prs
 * @returns {string} markdown 表（header 行 + 区切り + データ行）
 */
export function buildContainedPrTable(prs) {
	const contained = (prs ?? [])
		.filter((p) => classifyForContainedList(p) === 'contained')
		.slice()
		.sort((a, b) => a.number - b.number);

	const header = '| PR | title | type label | 対象領域 |\n|---|---|---|---|';

	if (contained.length === 0) {
		// 差分ゼロでも表 section は維持する（gate / template 整合）。空であることを明示。
		return `${header}\n| _(含有 PR なし — develop と main の差分が 0)_ | — | — | — |`;
	}

	const rows = contained.map((p) => {
		const num = `#${p.number}`;
		const title = escapeCell(p.title);
		const type = `\`${escapeCell(extractTypeLabel(p))}\``;
		const area = `\`${escapeCell(extractAreaLabel(p))}\``;
		return `| ${num} | ${title} | ${type} | ${area} |`;
	});

	return `${header}\n${rows.join('\n')}`;
}

/**
 * #3423: 含有 PR 群が **closing keyword で閉じると宣言した issue 番号**を収集する純粋関数。
 *
 * close漏れ（fix は main 反映済だが issue が open のまま）を構造的に防ぐため、統合 PR 本文に
 * `Closes #N` を集約し、main merge 時に GitHub auto-close を発火させる（issue-close-gate は
 * PR-keyword close を skip 既定のため AC gate reopen も起きない）。
 *
 * **精度のため title の `#N` ではなく PR body の closing keyword のみを採用する**:
 * - title `#N` は EPIC 親 (`[#3260 F2]`) や括弧参照 (`#3133 (#3131 監査検出)`) を含み over-close する。
 * - 部分対応 PR は body に `関連: #N`（closing keyword なし）を書く運用のため、`closes/fixes/resolves`
 *   を書いた PR のみを閉じる = 部分 PR を誤って閉じない（#3404 等の partial を尊重）。
 *
 * @param {Array<{ number: number; headRefName?: string; labels?: Array<string|{name:string}>; body?: string }>} prs
 * @returns {number[]} 昇順・重複排除した issue 番号
 */
export function extractClosedIssues(prs) {
	const set = new Set();
	for (const p of prs ?? []) {
		if (classifyForContainedList(p) !== 'contained') continue;
		const body = typeof p.body === 'string' ? p.body : '';
		// GitHub closing keyword: close/closes/closed, fix/fixes/fixed, resolve/resolves/resolved + #N
		const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
		for (const m of body.matchAll(re)) {
			const n = Number(m[1]);
			if (Number.isInteger(n) && n > 0) set.add(n);
		}
	}
	return [...set].sort((a, b) => a - b);
}

/**
 * back-merge / drift 状態 section のデータ行を生成する純粋関数（B-5 #2951 contract）。
 * B-5 の `back-merge` label を持つ open PR（= 未取込 hotfix）を列挙し、
 * develop⇔main drift 日数を併記する。
 *
 * @param {{ backMergePrs?: Array<{ number: number; title: string }>; driftDays?: number|null }} input
 * @returns {string} markdown 断片
 */
export function buildBackMergeStatus({ backMergePrs = [], driftDays = null }) {
	const drift = typeof driftDays === 'number' && driftDays >= 0 ? `${driftDays}` : '不明';
	if (!backMergePrs || backMergePrs.length === 0) {
		return [
			'- 直近 hotfix back-merge: `該当なし`（未取込の `back-merge` label PR は 0 件）',
			`- develop⇔main drift: \`${drift}\` 日（前回統合 merge からの経過）`,
		].join('\n');
	}
	const list = backMergePrs
		.slice()
		.sort((a, b) => a.number - b.number)
		.map((p) => `#${p.number}（${escapeCell(p.title)}）`)
		.join(' / ');
	return [
		`- 直近 hotfix back-merge: ⚠️ **未取込 ${backMergePrs.length} 件**（出典: ${list}）`,
		'  → これらの `back-merge` PR を develop に取り込んでから統合 PR を merge してください（main/develop drift 防止、branch-strategy.md §5）。',
		`- develop⇔main drift: \`${drift}\` 日（前回統合 merge からの経過）`,
	].join('\n');
}

/**
 * template 内の指定 section（`## <見出し>` から次の `## ` まで）の本体を、
 * 見出し直後の `<!-- -->` 説明コメント以降を replacement で差し替える純粋関数。
 * 見出し行・直後の説明コメントは保持し、その後ろのデータ部分のみ差し替える。
 *
 * @param {string} template  template 全文
 * @param {string} heading   差し替え対象 section 見出し（例: '## 含有 PR 一覧'）
 * @param {string} replacement  データ部分の新しい本文
 * @returns {string} 差し替え後の template 全文
 */
export function replaceSectionBody(template, heading, replacement) {
	const lines = template.split('\n');
	const startIdx = lines.findIndex((l) => l.trim() === heading);
	if (startIdx === -1) return template; // section が無ければ無変更（防御的）

	// 次の `## ` 見出し（または EOF）まで
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i += 1) {
		if ((lines[i] ?? '').startsWith('## ')) {
			endIdx = i;
			break;
		}
	}

	// section 内で、見出し直後の `<!-- ... -->` 説明コメントブロックは保持する。
	let insertIdx = startIdx + 1;
	while (insertIdx < endIdx && (lines[insertIdx] ?? '').trim() === '') insertIdx += 1; // 先頭空行 skip
	if (insertIdx < endIdx && (lines[insertIdx] ?? '').trim().startsWith('<!--')) {
		while (insertIdx < endIdx && !(lines[insertIdx] ?? '').includes('-->')) insertIdx += 1;
		if (insertIdx < endIdx) insertIdx += 1; // `-->` 行の次へ
	}

	const before = lines.slice(0, insertIdx);
	const after = lines.slice(endIdx);
	return [...before, '', replacement, '', ...after].join('\n');
}

/**
 * 統合 PR 本文全文を生成する facade 純粋関数（#2871 AC3 SSOT）。
 *
 * template (B-1 INTEGRATION_PR_TEMPLATE.md) を骨格に、
 *   - 「## 統合サマリ」: develop HEAD SHA / 統合対象期間
 *   - 「## 含有 PR 一覧」: develop merge 履歴から 4 列表を自動注入
 *   - 「## back-merge / drift 状態」: B-5 の back-merge PR + drift 日数
 * を差し替える。エビデンス表（§3）/ 監査 run 結果リンク（§4）/ NG 0 件宣言（§5）は
 * audit-manager run が記入する section のため差し替えず、template 本体（B-4 #2876 で実エビデンス
 * 基準 + SARIF + attestation 参照に更新済み）をそのまま保持する。
 *
 * @param {{
 *   template: string;
 *   prs: Array<{ number: number; title: string; headRefName?: string; labels?: Array<string|{name:string}>; body?: string }>;
 *   developHead: string;
 *   sinceDate?: string;
 *   untilDate?: string;
 *   backMergePrs?: Array<{ number: number; title: string }>;
 *   driftDays?: number|null;
 * }} input
 * @returns {string} 統合 PR 本文 markdown 全文
 */
export function renderIntegrationPrBody({
	template,
	prs,
	developHead,
	sinceDate = '',
	untilDate = '',
	backMergePrs = [],
	driftDays = null,
}) {
	let body = template;

	// 1. 統合サマリ
	// #3423: 含有 PR が closing keyword で閉じると宣言した issue を集約し `Closes #N` を本文に出す。
	// main merge 時に GitHub が auto-close し close漏れ（fix merge 済だが issue open）を構造的に防ぐ。
	const closedIssues = extractClosedIssues(prs);
	const closesLines =
		closedIssues.length > 0
			? [
					'',
					'**自動クローズ対象 issue（#3423 close漏れ防止 — main merge 時に GitHub が auto-close）:**',
					...closedIssues.map((n) => `Closes #${n}`),
				]
			: [
					'',
					'> 含有 PR に closing keyword（`Closes #N`）付き issue はありません（部分対応 PR / docs 等）。',
				];
	const summary = [
		`- 対象 develop HEAD: \`${escapeCell(developHead) || '不明'}\``,
		`- 統合対象期間: \`${escapeCell(sinceDate) || '前回統合 merge'}\` 〜 \`${escapeCell(untilDate) || '今回'}\``,
		'- 統合 PR 番号: 本 PR（develop → main、release PR パターンで常時 1 本最新化）',
		'',
		'> 統合 PR 自体は単一 Issue に紐づきませんが、含有 PR が `closes/fixes/resolves #N` で閉じると',
		'> 宣言した issue を下記 `Closes #N` に集約し、main merge 時に一括 auto-close します（#3423）。',
		'> 変更の出典は「含有 PR 一覧」が担保します（#2950 AC4）。',
		...closesLines,
		'',
		'> _この section は B-3（#2871）/ #3423 が develop HEAD / merge 履歴 / 含有 PR body から自動生成しています（手書きなし）。_',
	].join('\n');
	body = replaceSectionBody(body, '## 統合サマリ', summary);

	// 2. 含有 PR 一覧（自動注入）
	const containedTable = `${buildContainedPrTable(prs)}\n\n> _この表は B-3（#2871）が develop merge 履歴から自動生成しています。_`;
	body = replaceSectionBody(body, '## 含有 PR 一覧', containedTable);

	// 3. back-merge / drift 状態
	const backMergeStatus = buildBackMergeStatus({ backMergePrs, driftDays });
	body = replaceSectionBody(body, '## back-merge / drift 状態', backMergeStatus);

	// マージ判定エビデンス表（§3）/ 監査 run 結果リンク（§4）/ NG 0 件宣言（§5）は
	// audit-manager run が CI artifact を入力に記入する section のため、本 script では差し替えない。
	// template 本体（B-4 #2876 で実エビデンス基準 + SARIF + attestation 参照に更新済み）を骨格として保持する。

	return body;
}

/**
 * 簡易 argv パーサ。判定 logic は持たない。
 *
 * @param {string[]} argv process.argv.slice(2)
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

const isMain = (() => {
	try {
		return resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const templatePath = args.template;
	if (!templatePath) {
		console.error(
			'[integration-pr-body] Usage: cat prs.json | node scripts/integration-pr-body.mjs --template <path> --develop-head <sha> [--since <date>] [--until <date>] [--back-merge-prs <path>] [--drift-days <n>]',
		);
		process.exit(2);
	}

	let template;
	try {
		template = readFileSync(templatePath, 'utf8');
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[integration-pr-body] template 読込失敗 (${templatePath}): ${message}`);
		process.exit(3);
	}

	// PR 一覧は --prs <path>、または stdin（JSON 配列）から読む。
	const prsJson = args.prs ? readFileSync(args.prs, 'utf8') : readFileSync(0, 'utf8');
	const prs = prsJson.trim() ? JSON.parse(prsJson) : [];

	let backMergePrs = [];
	if (args['back-merge-prs']) {
		const bmJson = readFileSync(args['back-merge-prs'], 'utf8');
		backMergePrs = bmJson.trim() ? JSON.parse(bmJson) : [];
	}

	const driftDays = args['drift-days'] !== undefined ? Number(args['drift-days']) : null;

	const body = renderIntegrationPrBody({
		template,
		prs,
		developHead: args['develop-head'] ?? '',
		sinceDate: args.since ?? '',
		untilDate: args.until ?? '',
		backMergePrs,
		driftDays: Number.isFinite(driftDays) ? driftDays : null,
	});

	process.stdout.write(body);
	process.exit(0);
}
