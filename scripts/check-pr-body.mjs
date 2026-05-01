#!/usr/bin/env node
/**
 * scripts/check-pr-body.mjs — Issue #1775 AC2
 *
 * Ready 化前のローカルセルフチェック CLI から呼ばれる PR body スキャナ。
 * 直近 50 PR で頻発した以下 5 パターンを CI 検出前にローカルで掴むのが目的:
 *
 *   1. 必須セクション見出しの完全一致漏れ（PR #1718/#1746/#1760）
 *   2. PR body 全体での禁止語 (`予定` `follow-up` `PENDING` `DEFERRED` `別途` `個別起票` `TODO`) 混入
 *      （PR #1763/#1770 の AC マップ外混入を含めて検出する）
 *   3. AC 検証マップの 4 列フォーマット欠落 / 空行
 *   4. Ready for Review チェックリストの未チェック残置
 *   5. `mergeable: CONFLICTING` 事前検知（GitHub API 経由）
 *
 * 必須セクション SSOT:
 *   `.github/PULL_REQUEST_TEMPLATE.md` を runtime parse し、
 *   `^## ` で始まる見出しをそのまま完全一致比較に使う。テンプレ側を更新するだけで本スクリプトの
 *   検証も追従する（テンプレと scanner の同期ずれを防ぐ）。
 *
 * Usage:
 *   node scripts/check-pr-body.mjs --pr 1775
 *   node scripts/check-pr-body.mjs --body-file path/to/body.md         # gh pr view 不要なテスト用
 *   node scripts/check-pr-body.mjs --pr 1775 --skip-mergeable          # GitHub API を呼ばない
 *
 * exit:
 *   0 = OK
 *   1 = 違反検出（CI が CLI を直接呼ばないため、ローカル fail のみ。CI gate は別 workflow）
 *   2 = internal error
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const TEMPLATE_PATH = join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');

// ---------------------------------------------------------------------------
// 禁止語 SSOT（Issue 本文 / AC4 dev-session.md と一致させること）
// ---------------------------------------------------------------------------

/**
 * PR body の本文中（Markdown コメント `<!-- -->` を除く）に**現れたら fail** とする語彙。
 * 観察された PR 番号は Issue #1775 の本文を参照。
 *
 * 注: AC マップ内の「予定」もここで検出される。AC マップだけ見ていた既存の検査では
 * 「補足」「設計方針」「レビュー依頼」セクションへの混入を逃していたため、PR body 全体を対象にする。
 */
export const FORBIDDEN_TERMS = [
	'予定',
	'follow-up',
	'PENDING',
	'DEFERRED',
	'別途',
	'個別起票',
	'TODO',
];

// ---------------------------------------------------------------------------
// 必須セクション抽出（PR template の SSOT 化）
// ---------------------------------------------------------------------------

/**
 * `.github/PULL_REQUEST_TEMPLATE.md` から `^## ` で始まる見出しを抽出する。
 * 抽出した見出しの完全一致を PR body に求める（括弧書きの差し替えも検出する）。
 *
 * @param {string} template
 * @returns {string[]} 見出し配列（先頭 `## ` を含む）
 */
export function extractRequiredSections(template) {
	return template
		.split('\n')
		.filter((line) => /^## (?!#)/.test(line))
		.map((line) => line.trimEnd());
}

/**
 * PR body に template から抽出した必須セクション見出しが**完全一致で**全て存在するかを検証する。
 * @param {string} body
 * @param {string[]} requiredSections
 * @returns {string[]} 欠落 / 表記揺れがあった見出し
 */
export function findMissingSections(body, requiredSections) {
	const lines = body.split('\n').map((l) => l.trimEnd());
	const headingsInBody = new Set(lines.filter((l) => l.startsWith('## ')));
	return requiredSections.filter((req) => !headingsInBody.has(req));
}

// ---------------------------------------------------------------------------
// 禁止語スキャン（コメント除外）
// ---------------------------------------------------------------------------

/**
 * Markdown コメント `<!-- ... -->` をテンプレート由来の説明文として除外して、
 * 開発者が実際に書いた本文だけを対象にする。
 * @param {string} body
 * @returns {string}
 */
export function stripMarkdownComments(body) {
	// `<!--` から `-->` までを最短マッチで削除（複数行対応）
	return body.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Markdown コードブロック (``` fenced / `inline` ) を除外する。
 * Issue 本文の引用 / メタ言及（禁止語そのものを「禁止語の例: 予定 / TODO / ...」と列挙する場面）が
 * 本文意図ではないため除外する。`<!-- -->` と同様の SSOT 整合性を保つためのフィルタ。
 * @param {string} body
 * @returns {string}
 */
export function stripCodeBlocks(body) {
	return body
		.replace(/```[\s\S]*?```/g, '') // fenced code block
		.replace(/`[^`\n]+`/g, ''); // inline code
}

/**
 * 禁止語を PR body 全体（コメント・コードブロック除外後）からスキャンする。
 * @param {string} body
 * @returns {{ term: string; line: string; lineNo: number }[]}
 */
export function scanForbiddenTerms(body) {
	const cleaned = stripCodeBlocks(stripMarkdownComments(body));
	const violations = [];
	const lines = cleaned.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const term of FORBIDDEN_TERMS) {
			if (line.includes(term)) {
				violations.push({ term, line: line.trim(), lineNo: i + 1 });
			}
		}
	}
	return violations;
}

// ---------------------------------------------------------------------------
// AC 検証マップ 4 列フォーマット検証
// ---------------------------------------------------------------------------

/**
 * AC 検証マップセクションを抽出する。`## AC 検証マップ ...` の見出し以降、次の `## ` まで。
 * @param {string} body
 * @returns {string | null}
 */
export function extractAcMapSection(body) {
	const startMatch = body.match(/^## AC 検証マップ.*$/m);
	if (!startMatch) return null;
	const startIdx = body.indexOf(startMatch[0]);
	const remaining = body.slice(startIdx + startMatch[0].length);
	const nextSectionIdx = remaining.search(/^## /m);
	return nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
}

/**
 * AC 検証マップの table が「4 列 (`AC 番号 / AC 内容 / 検証手段 / 結果`) を埋めて」いるかを検証する。
 *
 * 検出する違反:
 *   - 空セルが残っている (`| | | | |`)
 *   - Markdown コメントだけのセル (`| <!-- ... --> |`) のみで実体がない
 *   - そもそもデータ行が 1 行も無い
 *
 * skip マーカーがある場合は検証をスキップ（template の `<!-- ac-verification-skip: ... -->`）。
 *
 * @param {string} body
 * @returns {{ id: string; message: string } | null}
 */
export function checkAcMap(body) {
	const skipMatch = body.match(/<!--\s*ac-verification-skip:[^>]+-->/);
	if (skipMatch) return null;

	const section = extractAcMapSection(body);
	if (!section) {
		return {
			id: 'ac-map-missing',
			message:
				'`## AC 検証マップ (ADR-0004)` セクションが見つかりません。PR template を使用してください。',
		};
	}

	const lines = section.split('\n').map((l) => l.trim());
	// データ行: `|` で始まり、ヘッダ (`AC 番号`) でも区切り (`---`) でもないもの
	const dataRows = lines.filter(
		(l) =>
			l.startsWith('|') &&
			!l.includes('AC 番号') &&
			!/^\|[\s|:-]+\|$/.test(l) &&
			!/^\|\s*-+\s*\|/.test(l),
	);

	if (dataRows.length === 0) {
		return {
			id: 'ac-map-empty',
			message:
				'AC 検証マップのデータ行が 1 行もありません。Issue の Acceptance Criteria 1 行ごとに 1 行を埋めてください。',
		};
	}

	// 各行が 4 列以上で、各セルがコメント以外の実体を持つかを検証
	const emptyRows = [];
	for (const row of dataRows) {
		// 行頭・行末の `|` を除いた中身を `|` で split
		const inner = row.replace(/^\|/, '').replace(/\|$/, '');
		const cells = inner.split('|').map((c) => c.trim());
		if (cells.length < 4) {
			emptyRows.push({ row, reason: `列数不足 (${cells.length} < 4)` });
			continue;
		}
		// 各セルから Markdown コメントを除いて空かを判定
		const filledCells = cells.slice(0, 4).map((c) => stripMarkdownComments(c).trim());
		if (filledCells.some((c) => c === '')) {
			emptyRows.push({ row, reason: `空セル (実体: ${JSON.stringify(filledCells)})` });
		}
	}

	if (emptyRows.length > 0) {
		return {
			id: 'ac-map-incomplete',
			message:
				`AC 検証マップに未記入セルが ${emptyRows.length} 行あります:\n` +
				emptyRows
					.slice(0, 5)
					.map((e) => `  - ${e.reason}: ${e.row.slice(0, 100)}`)
					.join('\n'),
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Ready for Review チェックリスト未チェック検出
// ---------------------------------------------------------------------------

/**
 * `## Ready for Review チェックリスト` 内の `- [ ]` を検出する。
 * `## 完了チェックリスト` も同様（既存の pr-merge-gate.yml と一致）。
 * AC4 で template から「CI が全て通過している」項目を削除する設計と整合する
 * （CI 自己言及循環の解消後はこの項目自体が存在しない）。
 *
 * @param {string} body
 * @returns {{ section: string; uncheckedCount: number }[]}
 */
export function findUncheckedReadyChecklist(body) {
	const targetSections = ['## Ready for Review チェックリスト', '## 完了チェックリスト'];
	const results = [];
	for (const section of targetSections) {
		const startIdx = body.indexOf(section);
		if (startIdx === -1) continue;
		const remaining = body.slice(startIdx + section.length);
		const nextSectionIdx = remaining.search(/^## /m);
		const sectionBody = nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
		const unchecked = (sectionBody.match(/^\s*- \[ \]/gm) || []).length;
		if (unchecked > 0) {
			results.push({ section: section.replace('## ', ''), uncheckedCount: unchecked });
		}
	}
	return results;
}

// ---------------------------------------------------------------------------
// mergeable: CONFLICTING 事前検知（GitHub API）
// ---------------------------------------------------------------------------

/**
 * `gh pr view <number> --json mergeable,mergeStateStatus` を呼び出し、CONFLICTING を返したら違反扱い。
 * gh CLI が無い / オフライン / fork PR で取得できない場合は null（スキップ）を返す。
 *
 * @param {string|number} prNumber
 * @returns {{ id: string; message: string } | null}
 */
export function checkMergeable(prNumber) {
	if (!prNumber) return null;
	let raw;
	try {
		raw = execSync(`gh pr view ${prNumber} --json mergeable,mergeStateStatus`, {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000,
		});
	} catch {
		// gh 未認証 / PR 未作成 / network 不通 — pre-ready 段階では PR がまだ存在しないことが普通なのでスキップ
		return null;
	}
	let data;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (data.mergeable === 'CONFLICTING' || data.mergeStateStatus === 'DIRTY') {
		return {
			id: 'mergeable-conflicting',
			message:
				`PR #${prNumber} は base branch (main) と CONFLICTING です。Ready 化前に rebase して conflict 解消してください。\n` +
				`  gh pr checkout ${prNumber}\n  git fetch origin && git rebase origin/main\n  # conflict 解消後\n  git push --force-with-lease`,
		};
	}
	return null;
}

// ---------------------------------------------------------------------------
// PR body 取得
// ---------------------------------------------------------------------------

/**
 * `gh pr view <num> --json body` で PR body を取得する。
 * @param {string|number} prNumber
 * @returns {string}
 */
function fetchPrBody(prNumber) {
	const raw = execSync(`gh pr view ${prNumber} --json body --jq .body`, {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return raw;
}

// ---------------------------------------------------------------------------
// CLI 引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const args = { pr: null, bodyFile: null, skipMergeable: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--pr' || a === '-p') {
			args.pr = argv[++i];
		} else if (a.startsWith('--pr=')) {
			args.pr = a.slice('--pr='.length);
		} else if (a === '--body-file') {
			args.bodyFile = argv[++i];
		} else if (a.startsWith('--body-file=')) {
			args.bodyFile = a.slice('--body-file='.length);
		} else if (a === '--skip-mergeable') {
			args.skipMergeable = true;
		} else if (a === '--help' || a === '-h') {
			args.help = true;
		}
	}
	return args;
}

function printHelp() {
	console.log(`
check-pr-body.mjs — PR body のセルフチェック (Issue #1775 AC2)

Usage:
  node scripts/check-pr-body.mjs --pr <number>
  node scripts/check-pr-body.mjs --body-file <path>      # 単体テスト・dry-run 用
  node scripts/check-pr-body.mjs --pr <number> --skip-mergeable

Options:
  --pr <num>          GitHub PR 番号 (gh pr view で body 取得)
  --body-file <path>  ローカルファイルから body を読む（PR 未作成時の dry-run 用）
  --skip-mergeable    GitHub API 呼び出しをスキップ (オフライン環境用)
  --help, -h          このヘルプを表示

Detected violations:
  1. 必須セクション見出しの欠落 / 表記揺れ（PR template SSOT）
  2. 禁止語 (${FORBIDDEN_TERMS.join(' / ')}) の混入（コメント以外）
  3. AC 検証マップの 4 列未記入 (skip マーカー時を除く)
  4. Ready for Review / 完了チェックリストの未チェック残置
  5. PR が CONFLICTING (--pr 指定時)

Exit codes:
  0 = OK
  1 = 違反検出
  2 = internal error
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return 0;
	}

	let body;
	if (args.bodyFile) {
		if (!existsSync(args.bodyFile)) {
			console.error(`[check-pr-body] ERROR: --body-file が存在しません: ${args.bodyFile}`);
			return 2;
		}
		body = readFileSync(args.bodyFile, 'utf-8');
	} else if (args.pr) {
		try {
			body = fetchPrBody(args.pr);
		} catch (e) {
			console.error(`[check-pr-body] ERROR: gh pr view で body 取得失敗: ${e.message}`);
			return 2;
		}
	} else {
		console.error('[check-pr-body] ERROR: --pr <number> または --body-file <path> が必要です');
		printHelp();
		return 2;
	}

	if (!existsSync(TEMPLATE_PATH)) {
		console.error(`[check-pr-body] ERROR: PR template が見つかりません: ${TEMPLATE_PATH}`);
		return 2;
	}
	const template = readFileSync(TEMPLATE_PATH, 'utf-8');
	const requiredSections = extractRequiredSections(template);

	const violations = [];

	// 1. 必須セクション
	const missing = findMissingSections(body, requiredSections);
	if (missing.length > 0) {
		violations.push({
			id: 'missing-required-sections',
			issue: '#1718/#1746/#1760',
			message:
				`PR body から以下の必須セクション見出しが完全一致で見つかりません ` +
				`(template 側を SSOT とした runtime 比較。括弧書きを削除した場合も検出されます):\n` +
				missing.map((s) => `  - ${s}`).join('\n') +
				`\n対応: .github/PULL_REQUEST_TEMPLATE.md の見出しをそのままコピーして PR body に貼り直す。`,
		});
	}

	// 2. 禁止語
	const forbidden = scanForbiddenTerms(body);
	if (forbidden.length > 0) {
		const sample = forbidden
			.slice(0, 6)
			.map((v) => `  - L${v.lineNo} 「${v.term}」: ${v.line.slice(0, 80)}`)
			.join('\n');
		violations.push({
			id: 'forbidden-terms',
			issue: '#1763/#1770',
			message:
				`PR body に禁止語が ${forbidden.length} 件混入しています ` +
				`(本 Issue #1775 で AC マップ外も含めた全体スキャンに拡張):\n${sample}\n` +
				`対応: 「予定」「TODO」「follow-up」等は本 PR で完遂するか、Issue 起票して PR から完全に除去する。partial PR は禁止。`,
		});
	}

	// 3. AC マップ
	const acMap = checkAcMap(body);
	if (acMap) violations.push({ ...acMap, issue: '#1775 AC2' });

	// 4. Ready for Review チェックリスト
	const unchecked = findUncheckedReadyChecklist(body);
	if (unchecked.length > 0) {
		violations.push({
			id: 'unchecked-ready-checklist',
			issue: '#1481',
			message:
				unchecked
					.map((u) => `  - 「${u.section}」に未チェック項目が ${u.uncheckedCount} 件`)
					.join('\n') +
				`\n対応: 全項目を [x] にするか、N/A を本文に明記する。AC4 で「CI が全て通過している」を template から削除済み。`,
		});
	}

	// 5. mergeable
	if (args.pr && !args.skipMergeable) {
		const mergeable = checkMergeable(args.pr);
		if (mergeable) violations.push({ ...mergeable, issue: '#1672/#1675/#1718/#1753' });
	}

	if (violations.length === 0) {
		console.log('[check-pr-body] OK — 違反なし');
		return 0;
	}

	console.log(`[check-pr-body] FAIL — ${violations.length} 件の違反:\n`);
	for (const v of violations) {
		console.log(`✗ [${v.id}] (${v.issue})`);
		console.log(`  ${v.message.split('\n').join('\n  ')}\n`);
	}
	return 1;
}

const isMain = (() => {
	try {
		const here = resolve(fileURLToPath(import.meta.url));
		const argv1 = resolve(process.argv[1] || '');
		return here === argv1;
	} catch {
		return false;
	}
})();

if (isMain) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error('[check-pr-body] internal error:', err);
			process.exit(2);
		});
}
