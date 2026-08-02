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
 *   6. 変更タイプ checkbox 未選択（#3846、CI gate「変更タイプの選択」の shift-left。
 *      判定は scripts/pr-template-gate-checks.mjs の checkChangeType を SSOT として再利用）
 *   7. `po-decision:required` label 付きなのに PO 決裁ブリーフが body にない（#3944/#3956/#3962）
 *
 * 必須セクション SSOT:
 *   `.github/PULL_REQUEST_TEMPLATE.md` を runtime parse し、
 *   `^## ` で始まる見出しをそのまま完全一致比較に使う。テンプレ側を更新するだけで本スクリプトの
 *   検証も追従する（テンプレと scanner の同期ずれを防ぐ）。
 *
 * Usage:
 *   node scripts/check-pr-body.mjs --pr 1775
 *   node scripts/check-pr-body.mjs --body-file path/to/body.md --no-labels  # PR 未作成の dry-run
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
import { checkIntegrationEvidenceTable } from './check-ac-verification-map.mjs';
import { extractClosedIssues } from './integration-pr-body.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';
import { classifyLane } from './pr-lane.mjs';
import { checkChangeType } from './pr-template-gate-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// lane-aware 化 (#4130)
//
// #4125 が本 CLI を CI (pr-merge-gate.yml / pr-body-check) に配線した時点で、
// lane-aware な 3 点セット (pr-ac-verification-check.yml / pr-merge-gate.yml /
// pr-template-gate-checks.mjs) のうち **本 CLI だけが lane 非対応**のまま載った。
// 統合 PR (release/* → main) は feature 用 template を持たないため
// `missing-required-sections` / `ac-map-missing` が **body の内容にかかわらず必ず立ち**、
// 「赤いが無視してよい check」が常設される状態になっていた (実測: PR #4126)。
//
// 対処は「統合 PR では job / 検査ごと skip」ではなく **観点の切替**にする
// (#2942 no-go = required check の空洞化禁止 と同じ方針)。統合 PR の body も
// 必ず検査対象に残す。
// ---------------------------------------------------------------------------

/** feature / hotfix / dependabot lane が参照する PR template (従来の唯一の参照先)。 */
const FEATURE_TEMPLATE_PATH = join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
/** integration lane (統合 PR) が参照する template (#2950 で確定した別系統)。 */
const INTEGRATION_TEMPLATE_PATH = join(repoRoot, '.github', 'INTEGRATION_PR_TEMPLATE.md');

/** `scripts/pr-lane.mjs` が返す lane の全集合 (typo で gate を空振りさせないための受理集合)。 */
export const VALID_LANES = Object.freeze(['feature', 'integration', 'hotfix', 'dependabot']);

/**
 * lane に対応する PR template のパスを返す (#4130 AC1)。
 *
 * feature / hotfix / dependabot は従来どおり feature 用 template。
 * lane を増やす場合はここ 1 箇所で対応付ける (呼び出し側に分岐を散らさない)。
 *
 * @param {string} lane
 * @returns {string}
 */
export function templatePathForLane(lane) {
	return lane === 'integration' ? INTEGRATION_TEMPLATE_PATH : FEATURE_TEMPLATE_PATH;
}

/**
 * lane に対応する template を読み、必須セクション見出しを抽出する (#4130 AC1)。
 *
 * @param {string} lane
 * @returns {{ template: string; requiredSections: string[]; path: string }}
 * @throws {Error} template が存在しない場合 (呼び出し側が exit 2 にする)
 */
export function loadTemplateForLane(lane) {
	const path = templatePathForLane(lane);
	if (!existsSync(path)) {
		throw new Error(`PR template が見つかりません: ${path} (lane=${lane})`);
	}
	const template = readFileSync(path, 'utf-8');
	return { template, requiredSections: extractRequiredSections(template), path };
}

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
 *
 * CodeQL js/incomplete-multi-character-sanitization 対策として、
 * 1 回 replace するだけでは入れ子コメント `<!-- <!-- x --> -->` の外側 `-->` 後に
 * `<!--` が残る可能性があるため、変化が無くなるまで反復する。
 *
 * @param {string} body
 * @returns {string}
 */
export function stripMarkdownComments(body) {
	let prev;
	let curr = body;
	do {
		prev = curr;
		curr = curr.replace(/<!--[\s\S]*?-->/g, '');
	} while (curr !== prev);
	return curr;
}

/**
 * Markdown コードブロック (``` fenced / `inline` ) を除外する。
 * Issue 本文の引用 / メタ言及（禁止語そのものを「禁止語の例: 予定 / TODO / ...」と列挙する場面）が
 * 本文意図ではないため除外する。`<!-- -->` と同様の SSOT 整合性を保つためのフィルタ。
 *
 * CodeQL js/incomplete-multi-character-sanitization 対策として、
 * 入れ子コードブロック ``` ``` ``` ``` のような構造でも残存しないよう反復する。
 *
 * @param {string} body
 * @returns {string}
 */
export function stripCodeBlocks(body) {
	let prev;
	let curr = body;
	do {
		prev = curr;
		curr = curr
			.replace(/```[\s\S]*?```/g, '') // fenced code block
			.replace(/`[^`\n]+`/g, ''); // inline code
	} while (curr !== prev);
	return curr;
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
		const line = lines[i] ?? '';
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
				'AC 検証マップのデータ行が 1 行もありません。Issue の Acceptance Criteria 1 行ごとに 1 行を埋めてください。\n' +
				'  期待形式 (4 列固定): `| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |`\n' +
				'  参考 PR (4 列 SSOT 実装例): #2588 / #2599',
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
					.join('\n') +
				`\n  期待形式 (4 列固定): \`| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |\`\n` +
				`  参考 PR (4 列 SSOT 実装例): #2588 / #2599\n` +
				`  修正手順: PR body の AC マップを上記 4 列 header に置換、各セルに HEAD SHA + file:line + grep + 実体根拠を付与する (2 列簡略形式禁止、#1775 AC2 / #2586)`,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// AC 検証マップ 根拠の参照整合 (#4074)
// ---------------------------------------------------------------------------

/**
 * 根拠欄に現れる `--pr <番号>` の PR 番号を抽出する (#4074)。
 *
 * `--pr <num>` / `--pr <N>` 等のプレースホルダは数字でないので拾わない (AC3 後方互換)。
 *
 * @param {string} body
 * @returns {number[]} 出現順・重複除去済みの PR 番号
 */
export function extractEvidencePrNumbers(body) {
	const section = extractAcMapSection(body);
	if (!section) return [];
	/** @type {number[]} */
	const found = [];
	for (const m of section.matchAll(/--pr[=\s]+(\d+)\b/g)) {
		const n = Number(m[1]);
		if (!found.includes(n)) found.push(n);
	}
	return found;
}

/**
 * AC 検証マップの根拠が **その PR 自身**を検証したものかを検証する (#4074 AC1)。
 *
 * 実測 (#4074): PR #4063 の AC 検証マップに `npm run pre-ready -- --pr 4059` と書かれていた。
 * #4059 は存在しない PR (`gh api .../pulls/4059` → 404) だが、`check-pr-body.mjs --pr 4063` は
 * 「OK — 違反なし」を返し CI も全 pass した。**宛先違いの証跡でも Ready 化を通過できた。**
 *
 * 番号の実在確認 (GitHub API) ではなく **自 PR 番号との一致**で判定する。
 * `gh pr view <N> --json <単一フィールド>` は存在しない PR でも値を返すため実在確認は当てにならず、
 * 一方「自 PR と一致しない番号」は実在・非実在を問わず宛先違いなので、一致判定だけで
 * 本 Issue の欠陥 (実在しない 4059 / 別 PR の番号) を両方とも落とせる。ネットワーク非依存。
 *
 * 対象は AC 検証マップセクションのみ。body の他所 (背景・関連 PR への言及) は正当に他 PR 番号を
 * 含むため対象外にして誤検出を作らない (AC3)。
 *
 * @param {string} body
 * @param {string | number | null | undefined} prNumber 自 PR 番号 (`--body-file` dry-run では null)
 * @returns {{ id: string; message: string } | null}
 */
export function checkEvidencePrReferences(body, prNumber) {
	// 自 PR 番号が分からない dry-run では「一致」を判定できない。ここで嘘の pass / fail を作らない
	// (`--pr` 指定の pre-ready Step 9 / CI では必ず判定される)。
	if (prNumber === null || prNumber === undefined || String(prNumber).trim() === '') return null;
	const self = Number(String(prNumber).trim());
	if (!Number.isFinite(self)) return null;

	const mismatched = extractEvidencePrNumbers(body).filter((n) => n !== self);
	if (mismatched.length === 0) return null;

	return {
		id: 'evidence-pr-mismatch',
		message:
			`AC 検証マップの根拠が本 PR (#${self}) 以外の PR 番号を指しています: ` +
			`${mismatched.map((n) => `--pr ${n}`).join(' / ')}\n` +
			`  根拠コマンドの \`--pr <番号>\` は **その PR 自身**を検証したものでなければ証跡になりません ` +
			`(別 PR / 存在しない番号を指した状態で Ready 化を通した実測: PR #4063 の \`--pr 4059\`)。\n` +
			`  対応: 根拠欄の番号を ${self} に直し、\`npm run pre-ready -- --pr ${self}\` を実際に実行し直して結果を貼る。\n` +
			`  番号を書かない形式 (\`--pr <num>\` 等のプレースホルダ) は従来どおり通ります。`,
	};
}

// ---------------------------------------------------------------------------
// Closes 宣言の着地確認 (#4170 AC2)
//
// ## 何を検査するのか
//
// 手元の下書き body が宣言した `Closes #N` が、**GitHub 上の実 PR body に着地しているか**を
// 検証する。下書きだけ編集して `gh pr edit --body-file` を流し忘れた状態 (= 書いたつもり) を
// 機械で落とす。
//
// ## なぜ 4 件のうちこれだけを先に入れるのか (実装の優先根拠)
//
// 第19回統合監査 (#4152) で統合 PR 本文と GitHub 実態のずれが merge 直前に 4 回出た。
// うち 3 件は「書いた瞬間は正しく、後で GitHub 側の実態が動いた」= 記述が古いだけ。
// 本件 (#1) だけは **書いた瞬間から嘘**で、ローカル下書きだけ編集して push しておらず、
// 実 PR body には最初から存在しなかった。そして監査チームの指摘が決定的だった:
//
//   > `Closes` 行は auto-close の実処理に直結し、merge されると main 上の恒久記録になります
//
// 違いは**記述の正確さではなく副作用の有無**である。他 3 件は読み手が誤読するだけだが、
// `Closes` の欠落は **GitHub の実処理が起きない** (閉じるべき Issue が閉じない)。逆に意図せず
// 存在すれば、閉じてはいけない Issue が閉じる。だから AC1 / AC3 / AC4 より先にこれを入れる。
//
// ## 案 C (表の骨格を機械生成) に将来寄せようとする人へ
//
//   案 C (表の骨格を機械生成) では「なぜ未解決か / 誰の手にあるか」は生成できない。
//   #4156 がどの mailbox にも入っていないと気づけたのは、まさにその判断列だった
//   (監査チーム、2026-08-01)。
//
// 機械が生成できるのは番号・state・label まで。「機械生成に寄せれば安全」は成り立たないので、
// 本 gate を「生成に置き換えれば不要になるもの」と読まないこと。
//
// ## grep では代替できない理由 (実測)
//
// `grep -c "Closes #4129"` は **撤回経緯の言及にもヒットする**。PR #4152 の実 body で計測すると
// 素朴な grep は 4 件返すが、実際に auto-close される宣言は 0 件だった (`Closes #4129` は撤回済で、
// 散文・判定表・mermaid ノードの中にしか残っていない)。したがって判定は **行頭一致 + code fence
// 除去 + conventional-commit prefix 除外**を行う既存 SSOT (`integration-pr-body.mjs` の
// `extractClosedIssues`) に委ね、本 file で regex を再実装しない。統合 PR 本文の集約側と本 gate の
// 検査側で「何が closing 宣言か」の判定が常に一致する (二重実装なし)。
// ---------------------------------------------------------------------------

/**
 * body から **実際に auto-close を発火させる** closing 宣言の Issue 番号を取り出す (#4170)。
 *
 * 判定は `integration-pr-body.mjs` の `extractClosedIssues` に委譲する (行頭一致 SSOT)。
 * 同関数は PR 配列を受けて `classifyForContainedList` で back-merge / 統合 PR 自身を除外するため、
 * ここでは head / label を持たない合成 PR を 1 件渡して body だけを走査させる。
 *
 * @param {string} body
 * @returns {number[]} 昇順・重複排除した Issue 番号
 */
export function extractLandedClosingIssues(body) {
	return extractClosedIssues([{ number: 0, body: typeof body === 'string' ? body : '' }]);
}

/**
 * closing keyword を **位置を問わず**拾う素朴な抽出 (#4170)。
 *
 * これは判定には使わない。「grep 相当だと何を誤って拾うか」を出力に出して、
 * 撤回済み言及を close 宣言と読み違える運用ミス自体を可視化するためだけに使う。
 *
 * @param {string} body
 * @returns {number[]} 昇順・重複排除した Issue 番号
 */
export function extractClosingKeywordMentions(body) {
	const src = typeof body === 'string' ? body : '';
	const found = new Set();
	for (const m of src.matchAll(
		/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[ \t]*:?[ \t]*[#＃](\d+)/gi,
	)) {
		found.add(Number(m[1]));
	}
	return [...found].sort((a, b) => a - b);
}

/**
 * 下書き body の closing 宣言が GitHub 上の実 PR body に着地しているかを検証する (#4170 AC2)。
 *
 * 双方向で見る:
 *   - **missing** (下書きにあり実 body に無い) = 本 Issue の事故形。`gh pr edit` 流し忘れ。
 *     閉じるはずの Issue が閉じない
 *   - **extra** (実 body にあり下書きに無い) = 撤回したつもりの宣言が残っている形。
 *     閉じてはいけない Issue が閉じる。missing より静かに壊れるので同格で落とす
 *
 * @param {string} claimedBody 手元の下書き (`gh pr edit --body-file` に渡すつもりのファイル)
 * @param {string} liveBody GitHub 上の実 PR body (`gh pr view --json body`)
 * @returns {{ id: string; message: string } | null}
 */
export function checkClosesLanded(claimedBody, liveBody) {
	const claimed = extractLandedClosingIssues(claimedBody);
	const landed = extractLandedClosingIssues(liveBody);
	const missing = claimed.filter((n) => !landed.includes(n));
	const extra = landed.filter((n) => !claimed.includes(n));
	if (missing.length === 0 && extra.length === 0) return null;

	const lines = [
		`下書きの closing 宣言と GitHub 上の実 PR body が一致しません (#4170 AC2)。`,
		`  下書きの Closes: ${claimed.length === 0 ? '(なし)' : claimed.map((n) => `#${n}`).join(' / ')}`,
		`  実 body の Closes: ${landed.length === 0 ? '(なし)' : landed.map((n) => `#${n}`).join(' / ')}`,
	];
	if (missing.length > 0) {
		lines.push(
			`  ✗ 下書きにあるが実 body に無い: ${missing.map((n) => `Closes #${n}`).join(' / ')}`,
			`    = 下書きだけ編集して \`gh pr edit --body-file\` を流していない状態。このまま merge しても`,
			`      GitHub の auto-close は発火せず、Issue は開いたまま残ります。`,
		);
	}
	if (extra.length > 0) {
		lines.push(
			`  ✗ 実 body にあるが下書きに無い: ${extra.map((n) => `Closes #${n}`).join(' / ')}`,
			`    = 撤回したつもりの宣言が実 body に残っている状態。merge すると**閉じてはいけない Issue**が`,
			`      auto-close されます (main 上の恒久記録になり、後から静かに戻せません)。`,
		);
	}
	lines.push(
		`  対応: 下書きと実 body のどちらが正なのかを決め、\`gh pr edit <PR> --body-file <下書き>\` で揃えてから再実行する。`,
	);
	return { id: 'closes-not-landed', message: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// 本文の主張 vs GitHub 実態 (#4170 AC1 / AC3)
//
// ## なぜ要るのか
//
// 統合 PR 本文は **人が書いた時点のスナップショット**だが、参照先 (Issue の state / label /
// 表の行数) は**独立に動く生データ**である。第19回統合監査 (#4152) では merge 直前に
// 4 回ずれ、4 回とも adversarial reviewer が先に見つけた (目視では追いつかなかった)。
// **執筆と merge の間に間隔がある限り構造的に再発する。**
//
// ## あえて narrow にしている理由
//
// 本文は自然文なので「本文が何を主張しているか」を完全には読み取れない。
// **誤検出する gate は無視されるようになり、gate として死ぬ**。したがって
// **確信が持てる形だけを拾い、拾えないものは拾わない**:
//
//   - state / label 主張: **同一行**に `#N` と状態語 / label が両方あるときだけ
//   - 件数主張: 件数が**行末寄り**にあり、**直後に markdown 表が始まる**ときだけ
//
// 拾えない例 (意図的): 「前回 3 件だったが今回は増えた」のような相対表現 /
// 表を伴わない件数 / 複数行にまたがる主張 / 1 行に複数の #N がある場合。
// **これらは本 gate の射程外**であり、引き続き §3.8 step 7 の目視と adversarial に委ねる。

/** 本文が主張しうる Issue / PR の状態語。表記揺れを 2 値に正規化する。 */
const STATE_CLAIM_WORDS = Object.freeze([
	{ re: /\bCLOSED\b|閉じ(た|られた|ている)|close\s*済/i, state: 'CLOSED' },
	{ re: /\bOPEN\b|open\s*継続|開いたまま/i, state: 'OPEN' },
]);

/**
 * fenced code block だけを潰す純粋関数。
 *
 * `integration-pr-body.mjs` の `stripCode` は inline code も潰すが、本検査は
 * inline code で囲まれた label (`state:needs-po` 等) を読む必要があるため inline は残す。
 * fence を残すと「例示として書いた `#N は open`」を主張と読み違える。
 *
 * @param {string} text
 * @returns {string}
 */
function stripFencedBlocks(text) {
	return String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
}

/**
 * 本文から「同一行に `#N` と状態語 / label がある」主張を抽出する純粋関数 (#4170 AC1)。
 *
 * @param {string} body
 * @returns {{ number: number; line: string; claimedState: string | null; claimedLabels: string[] }[]}
 */
export function extractStateClaims(body) {
	/** @type {{ number: number; line: string; claimedState: string | null; claimedLabels: string[] }[]} */
	const claims = [];
	for (const rawLine of stripFencedBlocks(body).split('\n')) {
		const line = rawLine;
		const numbers = [...line.matchAll(/#(\d{2,})/g)].map((m) => Number(m[1]));
		if (numbers.length === 0) continue;

		const claimedState = STATE_CLAIM_WORDS.find((w) => w.re.test(line))?.state ?? null;
		const claimedLabels = [...line.matchAll(/`((?:state|status):[a-z-]+)`/g)].map((m) =>
			String(m[1]),
		);
		if (claimedState === null && claimedLabels.length === 0) continue;

		// 同一行に複数の #N があるとき、どれに掛かる主張かは決められない。
		// **決められないものは主張として扱わない** (誤検出を作らない)。
		if (numbers.length > 1) continue;

		claims.push({ number: Number(numbers[0]), line: line.trim(), claimedState, claimedLabels });
	}
	return claims;
}

/**
 * 抽出した主張を実測 (live) と突合する純粋関数 (#4170 AC1)。
 *
 * **実測が取れていない番号は violation にする** (silent pass にしない、ADR-0006)。
 * 取得できなかった理由が「番号の書き間違い」か「API 失敗」かを機械では区別できず、
 * 通すと gate が空洞化するため。
 *
 * @param {string} body
 * @param {Map<number, { state: string; labels: string[] }>} live
 * @returns {{ id: string; message: string } | null}
 */
export function checkStateClaims(body, live) {
	/** @type {string[]} */
	const mismatches = [];
	for (const claim of extractStateClaims(body)) {
		const actual = live.get(claim.number);
		if (!actual) {
			mismatches.push(
				`  ✗ #${claim.number}: 本文が状態を主張しているが、**実測が取れていません**\n` +
					`    主張: ${claim.line}\n` +
					`    番号の書き間違い / API 失敗のどちらかです。通すと gate が空洞化するため fail にします。`,
			);
			continue;
		}
		if (claim.claimedState !== null && claim.claimedState !== actual.state) {
			mismatches.push(
				`  ✗ #${claim.number}: 本文は ${claim.claimedState} と書いていますが、実測は **${actual.state}** です\n` +
					`    主張: ${claim.line}`,
			);
		}
		const missingLabels = claim.claimedLabels.filter((l) => !actual.labels.includes(l));
		if (missingLabels.length > 0) {
			mismatches.push(
				`  ✗ #${claim.number}: 本文が書いた label が実測にありません: ${missingLabels.join(' / ')}\n` +
					`    実測の label: ${actual.labels.length === 0 ? '(なし)' : actual.labels.join(' / ')}\n` +
					`    主張: ${claim.line}`,
			);
		}
	}
	if (mismatches.length === 0) return null;
	return {
		id: 'body-state-drift',
		message:
			`統合 PR 本文の主張が GitHub 実態とずれています (${mismatches.length} 件、#4170 AC1)。\n` +
			`**本文を書いた後に実態が動いた**か、最初から誤っています。\n` +
			`${mismatches.join('\n')}\n` +
			`  対応: 実測に合わせて本文を更新してから再実行する (実態の側を本文に合わせない)。`,
	};
}

/**
 * markdown 表の data 行か (区切り行を除く)。
 * @param {string} line
 * @returns {boolean}
 */
function isTableDataRow(line) {
	if (!/^\s*\|/.test(line)) return false;
	if (/^\s*\|[\s:|-]+\|?\s*$/.test(line)) return false; // 区切り行 (|---|---|)
	return true;
}

/**
 * template のプレースホルダ行か。実データとして数えない。
 * @param {string} line
 * @returns {boolean}
 */
function isPlaceholderRow(line) {
	return /#N{2,}/.test(line) || /<[^>]+>/.test(line);
}

/**
 * 「N 件」と主張し、直後に markdown 表が続く箇所を抽出する純粋関数 (#4170 AC3)。
 *
 * @param {string} body
 * @returns {{ claimed: number; actualRows: number; line: string }[]}
 */
export function extractCountClaims(body) {
	const lines = stripFencedBlocks(body).split('\n');
	/** @type {{ claimed: number; actualRows: number; line: string }[]} */
	const claims = [];

	for (let i = 0; i < lines.length; i++) {
		const line = String(lines[i] ?? '');
		// 件数は**行末寄り**にあるものだけ拾う (散文中の「3 件の指摘があった。詳細は…」を除外)
		const m = /(\d+)\s*件\s*[)）]?\s*$/.exec(line);
		if (!m) continue;

		// 直後 (空行を挟んで 3 行以内) に表が始まるときだけ主張として扱う
		let j = i + 1;
		let blanks = 0;
		while (j < lines.length && blanks < 3 && String(lines[j] ?? '').trim() === '') {
			blanks++;
			j++;
		}
		if (j >= lines.length || !isTableDataRow(String(lines[j] ?? ''))) continue;

		// 表の data 行を数える (1 行目は header、区切り行とプレースホルダは除外)
		let rows = 0;
		let seenHeader = false;
		for (; j < lines.length; j++) {
			const l = String(lines[j] ?? '');
			if (!/^\s*\|/.test(l)) break;
			if (!isTableDataRow(l)) continue;
			if (!seenHeader) {
				seenHeader = true;
				continue;
			}
			if (isPlaceholderRow(l)) continue;
			rows++;
		}
		claims.push({ claimed: Number(m[1]), actualRows: rows, line: line.trim() });
	}
	return claims;
}

/**
 * 件数主張と実際の表行数を突合する純粋関数 (#4170 AC3)。
 *
 * @param {string} body
 * @returns {{ id: string; message: string } | null}
 */
export function checkClaimedCounts(body) {
	const bad = extractCountClaims(body).filter((c) => c.claimed !== c.actualRows);
	if (bad.length === 0) return null;
	return {
		id: 'body-count-drift',
		message:
			`本文が主張する件数と表の行数が一致しません (${bad.length} 件、#4170 AC3)。\n` +
			bad
				.map(
					(c) =>
						`  ✗ 「${c.line}」と書いていますが、直後の表の data 行は **${c.actualRows} 行**です`,
				)
				.join('\n') +
			`\n  対応: 表を実態に合わせるか、件数の記述を直す。**表を書き足した後に件数を直し忘れる**のが典型です。`,
	};
}

/**
 * 本文が言及した Issue / PR 番号の state と label を実測する (#4170 AC1)。
 *
 * `fetchPrLabels` (#3962) と同じ理由で `--jq` を使わない: execSync は Windows で cmd.exe を
 * 経由し、cmd.exe は単一引用符を引用符として扱わないため jq がリテラル受領して落ちる。
 * 落ちても catch で握り潰すと **検査が一度も走らないまま「違反なし」が出る**。
 *
 * **取得できなかった番号は Map に入れない。** 呼び出し側 (`checkStateClaims`) が
 * 「実測が取れていない」として violation にする (silent pass にしない、ADR-0006)。
 *
 * Issue と PR は番号空間が同じなので、`gh issue view` が失敗したら `gh pr view` を試す。
 *
 * @param {number[]} numbers
 * @returns {Map<number, { state: string; labels: string[] }>}
 */
export function fetchIssueStates(numbers) {
	/** @type {Map<number, { state: string; labels: string[] }>} */
	const live = new Map();
	for (const n of [...new Set(numbers)]) {
		for (const kind of ['issue', 'pr']) {
			try {
				const raw = execSync(`gh ${kind} view ${n} --json state,labels`, {
					encoding: 'utf-8',
					stdio: ['ignore', 'pipe', 'ignore'],
					timeout: 15_000,
				});
				const parsed = JSON.parse(raw);
				const state = String(parsed?.state ?? '').toUpperCase();
				if (!state) break;
				const labels = Array.isArray(parsed?.labels)
					? parsed.labels.map((/** @type {{ name?: unknown }} */ l) => String(l?.name ?? '')).filter(Boolean)
					: [];
				// PR の state は OPEN / CLOSED / MERGED。MERGED は「開いていない」側に寄せる
				live.set(n, { state: state === 'MERGED' ? 'CLOSED' : state, labels });
				break;
			} catch {
				// issue で失敗したら pr を試す。両方失敗したら Map に入れない (= violation)
			}
		}
	}
	return live;
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
// hotfix label 検出 + 配布証跡強化チェック (#2343)
// ---------------------------------------------------------------------------

/**
 * hotfix 系 PR を示すラベル名 SSOT (#2343)。
 *
 * hotfix urgency 文脈での品質ゲート bypass 誘惑を構造的に止めるため、
 * 以下ラベル PR には ADR-0006 配布証跡欄の N/A 化を許容しない強化チェックを適用する。
 * ADR-0002 §4「品質ゲートは Critical でも省略しない」整合。
 */
export const HOTFIX_LABELS = ['priority:critical', 'hotfix'];

/**
 * PR ラベル配列に hotfix label が含まれるかを判定。
 *
 * @param {string[]} labels
 * @returns {boolean}
 */
export function hasHotfixLabel(labels) {
	return labels.some((l) => HOTFIX_LABELS.includes(l.trim().toLowerCase()));
}

/**
 * `## 配布済み env / secret (ADR-0006)` セクションを抽出する。
 * `## ` を含む次セクションまでが対象。
 *
 * @param {string} body
 * @returns {string | null}
 */
export function extractEnvDistributionSection(body) {
	const startMatch = body.match(/^## 配布済み env \/ secret.*$/m);
	if (!startMatch) return null;
	const startIdx = body.indexOf(startMatch[0]);
	const remaining = body.slice(startIdx + startMatch[0].length);
	const nextSectionIdx = remaining.search(/^## /m);
	return nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
}

/**
 * hotfix PR で `## 配布済み env / secret (ADR-0006)` セクションを強化検証する (#2343)。
 *
 * 検出する違反 (hotfix PR のみ適用):
 *   - `N/A` のみで `配布済み:` 行が 0 件 (env 追加 hotfix で配布漏れの可能性)
 *     → ただし `「新規 env / secret の追加なし」` 明示時は許容
 *
 * **注**: 本検出は false positive を避けるため警告レベル (info-only) で、`N/A` 明示時は pass。
 * 純粋な「env 追加していない hotfix」は `- [x] N/A — 新規 env / secret の追加なし` で許容される。
 *
 * @param {string} body
 * @param {string[]} labels - PR ラベル一覧
 * @returns {{ id: string; message: string } | null}
 */
export function checkEnvDistributionForHotfix(body, labels) {
	if (!hasHotfixLabel(labels)) return null;

	const section = extractEnvDistributionSection(body);
	if (!section) {
		return {
			id: 'hotfix-env-distribution-missing-section',
			message:
				`hotfix PR (${HOTFIX_LABELS.join(' / ')}) に \`## 配布済み env / secret (ADR-0006)\` ` +
				`セクションが存在しません。template 雛形 (npm run dev:open-pr -- --issue <num> --kind critical-fix) ` +
				`から再生成してください。`,
		};
	}

	const cleaned = stripCodeBlocks(stripMarkdownComments(section));
	const hasNaMark = /N\/A.*新規\s*env.*の追加なし|新規\s*env\s*\/\s*secret\s*の追加なし/m.test(
		cleaned,
	);
	const hasDistributionLine = /配布済み:/m.test(cleaned);

	if (hasNaMark) return null;
	if (hasDistributionLine) return null;

	return {
		id: 'hotfix-env-distribution-incomplete',
		message:
			`hotfix PR (${HOTFIX_LABELS.join(' / ')}) の \`## 配布済み env / secret (ADR-0006)\` ` +
			`セクションに「配布済み:」行が 1 件もなく、「N/A — 新規 env / secret の追加なし」明示もありません。\n` +
			`対応 1: env 追加がない hotfix なら明示的に \`- [x] N/A — 新規 env / secret の追加なし\` を本文に記載\n` +
			`対応 2: env 追加がある hotfix なら 4 経路全て (GitHub Secrets / Lambda / NUC .env / .env.example) の「配布済み:」行を列挙 (#2341 教訓)`,
	};
}

// ---------------------------------------------------------------------------
// PO 決裁ブリーフ欠落チェック (#3962)
// ---------------------------------------------------------------------------

/**
 * `.github/labeler.yml` が高リスクパス touch 時に自動付与するラベル (#3862)。
 * 付与された PR は PR body に PO 決裁ブリーフ (一枚絵 mermaid) が必須。
 */
export const PO_DECISION_LABEL = 'po-decision:required';

/**
 * PO 決裁ブリーフの見出し SSOT。
 * `.claude/skills/dev-open-pr/templates/po-decision-brief.md` の先頭見出しと一致させること。
 */
export const PO_DECISION_HEADING = '## PO 決裁ブリーフ';

/**
 * @param {string[]} labels
 * @returns {boolean}
 */
export function hasPoDecisionLabel(labels) {
	return labels.some((l) => l.trim().toLowerCase() === PO_DECISION_LABEL);
}

/**
 * `## PO 決裁ブリーフ` セクションを抽出する。`## ` を含む次セクションまでが対象。
 *
 * @param {string} body
 * @returns {string | null}
 */
export function extractPoDecisionSection(body) {
	const startMatch = body.match(/^## PO 決裁ブリーフ.*$/m);
	if (!startMatch) return null;
	const startIdx = body.indexOf(startMatch[0]);
	const remaining = body.slice(startIdx + startMatch[0].length);
	const nextSectionIdx = remaining.search(/^## /m);
	return nextSectionIdx === -1 ? remaining : remaining.slice(0, nextSectionIdx);
}

/**
 * `po-decision:required` label 付き PR に PO 決裁ブリーフが実体を伴って存在するかを検証する (#3962)。
 *
 * 発生経緯: PR #3944 / #3956 の 2 回連続で「label は付いているがブリーフが body にない」まま
 * Ready 化し、QA レビューで merge gate 指摘を受けた。label 付与 (labeler.yml) は自動化済みだが、
 * 付与に対応する body 要件が人間の記憶に依存していたため同型が再発した。ADR-0061
 * same-class-N→guard に従い、instance 修正 (その PR にブリーフを足す) ではなく機械 gate 化する。
 *
 * 検出する違反 (label 付き PR のみ適用):
 *   1. `## PO 決裁ブリーフ` 見出しが body にない (#3944 / #3956 の実際の形)
 *   2. 見出しはあるが mermaid ブロックがない (「一枚絵で判断できる」という様式要件を満たさない)
 *   3. 見出しはあるが template の未置換プレースホルダ `___` が残っている
 *
 * 検出しないもの: ブリーフの中身の妥当性 (判断層は QA / PO レビューの担当)。
 * ここで固定するのは「label と body の対応が取れていること」だけ。
 *
 * @param {string} body
 * @param {string[]} labels - PR ラベル一覧
 * @returns {{ id: string; message: string } | null}
 */
export function checkPoDecisionBrief(body, labels) {
	if (!hasPoDecisionLabel(labels)) return null;

	// 見出しが HTML コメント内にあるだけのケースを「存在する」と誤判定しないよう、
	// コメントを剥がしてから探す。コードブロックは mermaid 図の実体なので残す。
	const cleaned = stripMarkdownComments(body);
	const section = extractPoDecisionSection(cleaned);

	if (!section) {
		return {
			id: 'po-decision-brief-missing-section',
			message:
				`\`${PO_DECISION_LABEL}\` label が付いていますが、PR body に \`${PO_DECISION_HEADING}\` ` +
				`セクションがありません (#3944 / #3956 と同型)。\n` +
				`対応 1: \`.claude/skills/dev-open-pr/templates/po-decision-brief.md\` を PR body 末尾に append し、\n` +
				`        「___」を全て実際の内容に置換する (mermaid 一枚絵で PO が Yes/No を判断できること)。\n` +
				`対応 2: label が誤付与なら、外した理由を PR body に明記したうえで label を外す ` +
				`(判定 SSOT = .github/labeler.yml の po-decision:required エントリ)。`,
		};
	}

	if (!/```mermaid/.test(section)) {
		return {
			id: 'po-decision-brief-missing-diagram',
			message:
				`\`${PO_DECISION_HEADING}\` セクションに mermaid ブロックがありません。\n` +
				`様式 SSOT (PO 恒久要件 2026-07-23): PO は mermaid 図 1 枚 (+ UI 変更時は実機 SS) だけで ` +
				`Yes/No を判断できること。長文説明を主成果物にしない。\n` +
				`対応: \`.claude/skills/dev-open-pr/templates/po-decision-brief.md\` の flowchart をコピーして記入する。`,
		};
	}

	const placeholderCount = (section.match(/___/g) ?? []).length;
	if (placeholderCount > 0) {
		return {
			id: 'po-decision-brief-unfilled-placeholder',
			message:
				`\`${PO_DECISION_HEADING}\` セクションに template の未置換プレースホルダ \`___\` が ` +
				`${placeholderCount} 件残っています。\n` +
				`対応: 全ての「___」を 1 行 15〜25 字で言い切った内容に置換する。` +
				`③ 反対理由は tmp/adversarial-evidence/<pr>.json を生成してから転記する (AI 要約への過信を打ち消すため)。`,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// 未置換プレースホルダ検出 (body 全体、code fence 内を含む) — #4029
// ---------------------------------------------------------------------------

/**
 * 「置換されていないテンプレート断片」を示すトークン SSOT (#4029)。
 *
 * 発生経緯: PR #4002 の body L208 が `PRE_READY_LOG_PLACEHOLDER` のまま残り、その block を
 * 根拠に 2 箇所が `- [x]` を立てていた (成果物のない `[x]`)。当時の未置換検出は
 * `___` を PO 決裁セクション内でのみ見ていたため、**code fence 内の別表記**は素通りした。
 * fence を除外すると今回の実例をそのまま逃すので、**fence 内も対象**にする。
 *
 * HTML コメントだけは除外する (template 由来の記入ガイドが `<!-- 例: ___ -->` の形で
 * 残るのは正常であり、開発者が書いた本文ではないため)。除外は行番号を保つマスクで行う。
 *
 * 各 pattern の狭め方 (誤検出との境界、#4029):
 *   - `PLACEHOLDER` は**大文字のみ**。英文中の "placeholder" という単語を拾わない
 *   - `XXX` は `#XXX` (Issue 番号の伏せ字引用) / URL path (`/XXX`) / 語中 (`XXXY`) を除外
 *   - `___` は 3 連続以上のアンダースコア。Markdown の水平線 (`---`) とは別字
 */
export const PLACEHOLDER_PATTERNS = [
	{
		id: 'underscore-blank',
		label: '___ (template の空欄)',
		re: /_{3,}/g,
	},
	{
		id: 'placeholder-token',
		label: 'PLACEHOLDER / *_PLACEHOLDER',
		// `PRE_READY_LOG_PLACEHOLDER` のように接頭辞が付く形を確実に拾うため `\b` は使わない
		// (`_` は word 文字なので接頭辞境界に `\b` が立たず、#4002 の実例を取り逃がす)。
		re: /[A-Z0-9_]*PLACEHOLDER[A-Z0-9_]*/g,
	},
	{
		id: 'tbd',
		label: 'TBD',
		re: /\bTBD\b/g,
	},
	{
		id: 'xxx',
		label: 'XXX',
		re: /(?<![#/\w-])XXX(?![\w-])/g,
	},
	{
		id: 'japanese-angle-slot',
		label: '<ここに…> 型スロット',
		re: /<ここに[^>\n]*>/g,
	},
];

/**
 * 誤検出時の唯一の逃げ道 (#4029)。
 *
 * 本 gate 自身を直す PR / template を編集する PR は、プレースホルダ文字列を
 * 正当に本文へ書く。label による一括 skip は fail-open (label を付けるだけで gate が
 * 消える) なので採らず、**PR body に理由付きの宣言を 1 行書いた場合のみ**通す。
 */
export const PLACEHOLDER_SCAN_SKIP_RE = /<!--\s*placeholder-scan-skip:\s*([^>]*?)\s*-->/;

/** 宣言の理由に求める最小文字数 (「-」等の空宣言で gate を消させない)。 */
const PLACEHOLDER_SKIP_REASON_MIN_LENGTH = 10;

/**
 * HTML コメントを**行番号を保ったまま**空白化する (#4029)。
 * `stripMarkdownComments` は行ごと消えるため、検出行番号を PR body の実行番号と
 * 一致させたい本 gate では使えない。
 *
 * @param {string} body
 * @returns {string}
 */
export function maskMarkdownComments(body) {
	return body.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
}

/**
 * 未置換プレースホルダを PR body 全体 (code fence 内を含む) からスキャンする (#4029)。
 *
 * @param {string} body
 * @returns {{ id: string; token: string; line: string; lineNo: number }[]}
 */
export function scanPlaceholders(body) {
	const masked = maskMarkdownComments(body);
	const lines = masked.split('\n');
	const rawLines = body.split('\n');
	const violations = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		for (const pattern of PLACEHOLDER_PATTERNS) {
			const re = new RegExp(pattern.re.source, pattern.re.flags);
			let m = re.exec(line);
			while (m !== null) {
				violations.push({
					id: pattern.id,
					token: m[0],
					line: (rawLines[i] ?? '').trim(),
					lineNo: i + 1,
				});
				m = re.exec(line);
			}
		}
	}
	return violations;
}

/**
 * `<!-- placeholder-scan-skip: 理由 -->` 宣言を解釈する (#4029)。
 *
 * @param {string} body
 * @returns {{ declared: boolean; reason: string }}
 */
export function parsePlaceholderScanSkip(body) {
	const m = body.match(PLACEHOLDER_SCAN_SKIP_RE);
	if (!m) return { declared: false, reason: '' };
	return { declared: true, reason: (m[1] ?? '').trim() };
}

/**
 * 未置換プレースホルダ gate 本体 (#4029)。
 *
 * 宣言がある場合は「何を見逃したか」を violation ではなく notes として返す
 * (#3962 と同じ方針 — 見分けのつかない pass を作らない)。
 *
 * @param {string} body
 * @returns {{ violation: { id: string; message: string } | null; notes: string[] }}
 */
export function checkPlaceholders(body) {
	const found = scanPlaceholders(body);
	const skip = parsePlaceholderScanSkip(body);

	if (skip.declared) {
		if (skip.reason.length < PLACEHOLDER_SKIP_REASON_MIN_LENGTH) {
			return {
				violation: {
					id: 'placeholder-scan-skip-reason-missing',
					message:
						`\`<!-- placeholder-scan-skip: 理由 -->\` の理由が ${PLACEHOLDER_SKIP_REASON_MIN_LENGTH} 文字未満です ` +
						`(実際: ${JSON.stringify(skip.reason)})。\n` +
						'  対応: 「なぜこの PR が正当にプレースホルダ文字列を本文へ書くのか」を具体的に書く ' +
						'(例: 本 gate の検出対象トークンを PR body 内で説明するため)。',
				},
				notes: [],
			};
		}
		return {
			violation: null,
			notes: [
				`[check-pr-body] SKIPPED — 未置換プレースホルダ検査 (#4029) を宣言により skip しました (検出 ${found.length} 件)`,
				`  理由: ${skip.reason}`,
			],
		};
	}

	if (found.length === 0) return { violation: null, notes: [] };

	const sample = found
		.slice(0, 6)
		.map((v) => `  - L${v.lineNo} 「${v.token}」(${v.id}): ${v.line.slice(0, 80)}`)
		.join('\n');
	return {
		violation: {
			id: 'unreplaced-placeholder',
			message:
				`PR body に未置換プレースホルダが ${found.length} 件あります ` +
				`(code fence 内も対象、#4002 の実例がまさに fence 内でした):\n${sample}\n` +
				'対応 1: 実際の内容 (実行ログ / パス / 結果) に置換する。埋められないなら、それを根拠にした `[x]` を外す。\n' +
				'対応 2: 本 gate や template を直す PR で正当にプレースホルダ文字列を書く場合のみ、\n' +
				'        `<!-- placeholder-scan-skip: 理由 -->` を PR body に 1 行書く (label では通らない)。',
		},
		notes: [],
	};
}

// ---------------------------------------------------------------------------
// 文字化け検出 (BOM / heuristic) — #2562 / #2576
// ---------------------------------------------------------------------------

/**
 * PR body の文字化け (BOM / `??` 連続) を検出する。
 *
 * 検出原因 (#2562 再発防止):
 *   - heredoc (`gh pr create --body "$(cat <<EOF ... EOF)"`) を Windows cp932 環境で実行すると、
 *     non-ASCII 文字が cp932 化 → GitHub 投入 → `??` mojibake / BOM 残留が発生する。
 *   - 対応: PR body は必ず `--body-file <path>` 経由で UTF-8 file を投入する。
 *
 * @param {string} body
 * @returns {{ id: string; message: string }[]}
 */
export function detectMojibake(body) {
	const violations = [];

	// AC-1: BOM (﻿) 検出
	if (body.startsWith('﻿')) {
		violations.push({
			id: 'mojibake-bom',
			message:
				'PR body 冒頭に BOM (\\uFEFF) が検出されました。cp932 mojibake 由来の可能性が高いです。\n' +
				'  原因: heredoc (`gh pr create --body "$(cat <<EOF ... EOF)"`) を Windows cp932 環境で実行した場合、\n' +
				'        non-ASCII 文字が cp932 化されて GitHub 投入時に BOM / `??` mojibake が混入する。\n' +
				'  対応: `--body-file` 経由で UTF-8 file を投入してください。\n' +
				'    1. tmp/pr-bodies/<slug>.md に Write tool / `cat > ... << EOF` で UTF-8 で保存\n' +
				'    2. `gh pr edit <pr-number> --body-file tmp/pr-bodies/<slug>.md`\n' +
				'    3. `node scripts/check-pr-body.mjs --pr <pr-number>` で PASS 確認',
		});
	}

	// AC-2: `??` のヒューリスティック検出 (閾値: 5件以上、#2576 で 10 → 5 に強化)
	// 2026-05-28 に 4 連続再発 (#2562 / #2563 / #2566 / #2583) を観測したため
	// threshold を too lenient な 10 から 5 に下げて fail-fast を強化する。
	const questionMarks = body.match(/\?\?/g) ?? [];
	if (questionMarks.length >= 5) {
		violations.push({
			id: 'mojibake-heuristic',
			message:
				`PR body 内に \`??\` が ${questionMarks.length} 件 (閾値 5 件以上、#2576 で 10 → 5 に強化) 検出されました。` +
				`cp932 mojibake の疑いがあります。\n` +
				'  原因: heredoc (`gh pr create --body "$(cat <<EOF ... EOF)"`) を Windows cp932 環境で実行した場合、\n' +
				'        non-ASCII 文字が cp932 化されて GitHub 投入時に `??` mojibake が混入する。\n' +
				'  対応: `--body-file` 経由で UTF-8 file を投入してください。\n' +
				'    1. tmp/pr-bodies/<slug>.md に Write tool / `cat > ... << EOF` で UTF-8 で保存\n' +
				'    2. `gh pr edit <pr-number> --body-file tmp/pr-bodies/<slug>.md`\n' +
				'    3. `node scripts/check-pr-body.mjs --pr <pr-number>` で PASS 確認',
		});
	}

	return violations;
}

// ---------------------------------------------------------------------------
// 変更タイプ checkbox 未選択検出 (#3846、shift-left)
// ---------------------------------------------------------------------------

/**
 * `## 変更タイプ` セクションで `- [x]` が 1 つも選択されていない場合に violation を返す (#3846)。
 *
 * 背景: PR body の変更タイプ checkbox 未選択のまま提出 → CI 必須 gate「変更タイプの選択」
 * (`pr-template-gate.yml`) hard-fail が 3 PR 連続再発 (#3835 / #3837 / #3844)。いずれも実装は
 * 健全で body checkbox のみが原因 = ADR-0061 same-class-N→guard 対象。本検出により
 * `--body-file` mode (PR 作成前) / `--pr` mode (pre-ready Step 9 / pre-push hook) の両方で
 * CI より手前 (shift-left) で機械検出する。
 *
 * 検証ロジックは CI gate と同一 SSOT (`scripts/pr-template-gate-checks.mjs` の `checkChangeType`)
 * を再利用する (二重実装なし)。lane は本 CLI の対象 (feature / hotfix per-PR self-check) で
 * 判定が同一のため 'feature' 固定。section 欠落時は missing-required-sections gate に委譲
 * (checkChangeType 側が skipped=true を返す)。
 *
 * @param {string} body
 * @param {string} template `.github/PULL_REQUEST_TEMPLATE.md` の内容
 * @param {string[]} labels PR ラベル (dependencies label skip は SSOT 側で処理)
 * @returns {{ id: string; message: string } | null}
 */
export function checkChangeTypeSelection(body, template, labels = []) {
	const result = checkChangeType({
		body,
		labels,
		template,
		ssotSections: null,
		lane: 'feature',
	});
	if (result.ok) return null;
	return {
		id: 'change-type-unselected',
		message:
			`${result.message}\n` +
			'背景: 未選択のまま提出 → CI 必須 gate「変更タイプの選択」hard-fail が 3 PR 連続再発 (#3835 / #3837 / #3844)。\n' +
			'対応: PR 作成前に `node scripts/check-pr-body.mjs --body-file <path> --skip-mergeable --no-labels` で本検証を PASS させる。\n' +
			'      `npm run dev:open-pr -- --issue <num>` 経由なら Issue の type:* label から自動 [x] 化される (init-pr-body.mjs)。',
	};
}

// ---------------------------------------------------------------------------
// Self-Review 証跡検出 (#2475 Phase 2 / #2815 D-1、PO 判断 2026-06-04: 導入必須)
// ---------------------------------------------------------------------------

const SELF_REVIEW_SECTION_RE = /セルフレビュー|セルフチェック/;
// 機械検証コマンド証跡: backtick 内が npx/npm/node/grep/rg/git/gh/ls で始まるコマンド文字列。
// AC 検証マップ「検証手段」列・各 [x] の根拠記載が該当する。
const EVIDENCE_COMMAND_RE = /`(?:npx|npm|node|grep|rg|git|gh|ls)\s[^`]+`/;

/**
 * Self-Review 系セクション（コード品質セルフレビュー / テスト & 安全装置セルフチェック /
 * Ready for Review チェックリスト）に `[x]` の自己宣言があるのに、body 全体に機械検証
 * コマンドの証跡が 1 件も無い場合に violation を返す。
 *
 * 背景 (self-review-agent.md §2.4): 「証跡コマンド添付なしの PASS は false PASS と同等扱い」。
 * 観点を [x] で埋めるだけの形骸化 (rubber-stamp) を機械検出する。
 *
 * @param {string} body
 * @returns {{ id: string; message: string } | null}
 */
export function checkSelfReviewEvidence(body) {
	const stripped = stripMarkdownComments(body);
	const lines = stripped.split('\n');
	let inSelfReview = false;
	let checkedClaims = 0;
	for (const line of lines) {
		if (/^##\s/.test(line)) {
			inSelfReview = SELF_REVIEW_SECTION_RE.test(line);
			continue;
		}
		if (inSelfReview && /^\s*-\s*\[x\]/i.test(line)) {
			checkedClaims += 1;
		}
	}
	// 自己宣言ゼロ（セクション欠落は必須セクション gate が別途検出）
	if (checkedClaims === 0) return null;
	// 証跡コマンドが body のどこかに 1 件以上あれば PASS
	if (EVIDENCE_COMMAND_RE.test(stripped)) return null;
	return {
		id: 'self-review-evidence-missing',
		message:
			`Self-Review 系セクションに [x] 自己宣言が ${checkedClaims} 件あるのに、` +
			'機械検証コマンドの証跡 (`npx ...` / `grep ...` 等の backtick コマンド) が PR body に 1 件もありません。\n' +
			'  対応: AC 検証マップ「検証手段」列や各 [x] の根拠に、実行した検証コマンドと結果を添付する\n' +
			'        (docs/operations/self-review-agent.md §2.4: 証跡なき PASS は false PASS と同等扱い)。',
	};
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
		raw = execSync(`gh pr view ${prNumber} --json mergeable,mergeStateStatus,baseRefName`, {
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
		// #2959: develop 二層 cutover (#2870) 後は base が develop / main の 2 系統あるため、
		// rebase 指示は PR の実際の baseRefName に連動させる (main 固定だと誤指示になる)。
		const baseRef = data.baseRefName || 'main';
		return {
			id: 'mergeable-conflicting',
			message:
				`PR #${prNumber} は base branch (${baseRef}) と CONFLICTING です。Ready 化前に rebase して conflict 解消してください。\n` +
				`  gh pr checkout ${prNumber}\n  git fetch origin && git rebase origin/${baseRef}\n  # conflict 解消後\n  git push --force-with-lease`,
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

/**
 * `gh pr view <num> --json labels` で PR ラベル一覧を取得する (#2343)。
 *
 * #3962 (QA 指摘): 旧実装は gh 失敗を `catch { return [] }` で潰していたため、
 * 「label が付いていない」と「label を取得できなかった」を呼び出し側が区別できず、
 * label 条件付き検査 (hotfix / po-decision) が**黙って消えたうえで `OK — 違反なし`**
 * と表示された。gate の縮退方向が pass 側に倒れる典型なので、
 * **取得不能は `null` を返して呼び出し側で fail-closed させる**。
 * 空配列は「gh 取得に成功し、label が 1 件も無い」場合だけを意味する。
 *
 * @param {string|number|null} prNumber
 * @returns {string[] | null} 取得できなければ null (= 未解決)
 */
function fetchPrLabels(prNumber) {
	if (!prNumber) return null;
	try {
		// `--jq '[.labels[].name]'` を使わない (#3962): execSync は Windows で cmd.exe を経由し、
		// cmd.exe は単一引用符を引用符として扱わないため、jq が `'[.labels[].name]'` を
		// リテラル受領して `unexpected token "'"` で落ちる。旧実装は catch { return [] } で
		// これを潰していたので、**Windows のローカル開発機では label 条件付き検査
		// (hotfix #2343 / po-decision #3962) が一度も実行されないまま `OK — 違反なし` が
		// 出ていた**。shell の引用規則に依存しないよう、JSON を素で受けて JS 側で取り出す。
		const raw = execSync(`gh pr view ${prNumber} --json labels`, {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000,
		});
		return extractLabelNames(raw);
	} catch {
		return null;
	}
}

/**
 * `gh pr view --json labels` の生 JSON から label 名配列を取り出す (#3962)。
 *
 * 取り出せない形 (パース不能 / `labels` が配列でない) は **空配列に落とさず `null`**。
 * 「label が無い」と「label が読めなかった」を混ぜないのが本 Issue の主題であり、
 * ここで潰すと `resolveLabels()` の fail-closed が効かなくなる。
 *
 * @param {string} raw
 * @returns {string[] | null} 取り出せなければ null (= 未解決)
 */
export function extractLabelNames(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw.trim() || 'null');
	} catch {
		return null;
	}
	const labels = parsed && typeof parsed === 'object' ? parsed.labels : null;
	if (!Array.isArray(labels)) return null;
	return labels.map((l) => String(l?.name ?? l));
}

/**
 * label が付いているときだけ発火する gate の SSOT (#3962 QA 指摘)。
 *
 * `--no-labels` は「label が無い」ことの明示なので、これらの gate は正しく skip される。
 * ただし **何を検査しなかったかが出力に出ない限り、通常 pass と見分けがつかない**。
 * 見分けがつかない pass は本 Issue が塞ごうとしている失敗 class そのものなので、
 * skip した gate 名を件数付きで出すための一覧をここに固定する。
 *
 * `triggers` は発火 label の実値、`label` は表示用の文字列。
 *
 * @type {ReadonlyArray<{ name: string; issue: string; label: string; triggers: string[] }>}
 */
export const LABEL_CONDITIONAL_GATES = [
	{
		name: 'hotfix env 配布証跡 (ADR-0006)',
		issue: '#2343',
		label: HOTFIX_LABELS.join(' / '),
		triggers: [...HOTFIX_LABELS],
	},
	{
		name: 'PO 決裁ブリーフ',
		issue: '#3962',
		label: PO_DECISION_LABEL,
		triggers: [PO_DECISION_LABEL],
	},
];

/**
 * 与えた label 一覧で **発火しなかった** label 条件付き gate を返す (#3983)。
 *
 * `--no-labels` (labels = []) は全件が未発火になるので、全件 skip の特殊ケースになる。
 *
 * @param {string[]} labels
 * @returns {ReadonlyArray<{ name: string; issue: string; label: string; triggers: string[] }>}
 */
export function selectSkippedLabelGates(labels) {
	const normalized = labels.map((l) => l.trim().toLowerCase());
	return LABEL_CONDITIONAL_GATES.filter((g) => !g.triggers.some((t) => normalized.includes(t)));
}

/**
 * 「検査しなかった gate」を明示する出力行を組み立てる (#3962 QA 指摘 / #3983)。
 *
 * #3962 は `--no-labels` にだけ本出力を入れたため、`--labels <csv>` で
 * 発火しなかった gate は **通常 pass と見分けがつかない**まま残っていた (#3983)。
 * 「label をこちらが手で主張した」経路 (`--no-labels` / `--labels`) は、その主張が
 * 誤っていても検出できない以上、どちらも「検査していない」と表示する。
 * `--pr <N>` の実 label は PR の事実そのものなので「発火しなかった = 正しい判定」であり
 * 本出力の対象外 (毎回の pre-ready を無意味な SKIPPED 行で埋めない)。
 *
 * 呼び出し側が `console.log` するだけで済むよう、行配列で返す。skip 0 件なら空配列。
 * 将来メッセージを整理した拍子に無言化しないよう、gate 名の出現を test で固定している ([LB7])。
 *
 * @param {string[]} labels 検査に使う label 一覧
 * @param {string} source 経路の表示名 (`--no-labels` / `--labels`)
 * @returns {string[]}
 */
export function formatSkippedLabelGates(labels, source) {
	const skipped = selectSkippedLabelGates(labels);
	if (skipped.length === 0) return [];
	return [
		`[check-pr-body] SKIPPED — label 条件付き gate ${skipped.length} 件は検査していません (${source})`,
		...skipped.map((g) => `  - ${g.name} (${g.issue}) — 発火 label: ${g.label}`),
		`  ※ label が付いた後に --pr <N> で再実行しないと、上記 gate は一度も動きません`,
	];
}

/**
 * CLI 引数と `fetchPrLabels()` の結果から、検査に使う label 一覧を確定する (#3962)。
 *
 * label 条件付き検査 (hotfix #2343 / po-decision #3962) は「label が無い」なら
 * 正しく skip されるべきだが、「label が分からない」で skip すると gate が消える。
 * この 2 つを型で分離するのが本関数の目的で、**未解決は必ず error を返す** (fail-closed)。
 * dry-run で label がまだ存在しないことが分かっている場合は `--no-labels` で明示する。
 *
 * @param {{ pr: string | null; labels: string | null; noLabels: boolean }} args
 * @param {string[] | null} fetched `fetchPrLabels()` の戻り (未解決なら null)
 * @returns {{ labels: string[] } | { error: string }}
 */
export function resolveLabels(args, fetched) {
	if (args.noLabels) return { labels: [] };
	if (args.labels !== null) {
		const parsed = args.labels
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		// #3983: `--labels ""` / `--labels " , "` は「label 0 件の明示」ではなく、
		// `--labels "$LABELS"` で変数が空だった事故の形。#3965 が消した
		// `catch { return [] }` と同じ沈黙 fail-open になるので受理しない。
		// 「label が 0 件」を主張する引数は `--no-labels` が既にある。
		if (parsed.length === 0) {
			return {
				error:
					`--labels に有効な label がありません (受け取った値: ${JSON.stringify(args.labels)})。\n` +
					`  label 条件付き検査 (hotfix #2343 / po-decision #3962) が黙って全 skip されるのを防ぐため、\n` +
					`  空の --labels は受理しません (--labels "$VAR" で変数が空だった場合を含む)。\n` +
					`  対応: label 0 件を明示したいなら --no-labels を使ってください。`,
			};
		}
		return { labels: parsed };
	}
	if (fetched !== null) return { labels: fetched };
	if (args.pr) {
		return {
			error:
				`PR #${args.pr} の label を取得できませんでした (gh 未認証 / オフライン / timeout など)。\n` +
				`  label 条件付き検査 (hotfix #2343 / po-decision #3962) を実行できないため、pass 側に倒さず中断します。\n` +
				`  対応: gh auth status を確認して再実行するか、--labels <csv> / --no-labels で明示してください。`,
		};
	}
	return {
		error:
			`--body-file 単独では label を解決できません。\n` +
			`  label 条件付き検査 (hotfix #2343 / po-decision #3962) が黙って skip されるのを防ぐため、\n` +
			`  --labels <csv> か --no-labels のどちらかを明示してください。\n` +
			`  例: --no-labels                      # PR 未作成で label がまだ付いていない\n` +
			`      --labels po-decision:required    # 付く予定の label を先に検証する`,
	};
}

// ---------------------------------------------------------------------------
// Draft PR での Ready 化要件 deferral (#3997)
// ---------------------------------------------------------------------------

/**
 * **Ready 化の要件そのもの**を検査する gate の SSOT (#3997)。
 *
 * Draft は「まだ Ready の要件を満たしていない」ことを宣言する状態なので、これらを Draft に
 * 要求すると **Draft PR へ 1 commit も push できなくなる** (`.husky/pre-push` Step 3 が
 * PR の存在だけで発火するため)。実際 #3989 で「local に commit があるのに remote が
 * 7 時間前の HEAD のまま」という宙吊りが発生した。
 *
 * ここに載せる / 載せない の線引き:
 *   - 載せる (= Draft では deferred): 「Ready にしてよい状態か」を問う検査。
 *     Ready checklist の全 [x] (完遂宣言そのもの) / PO 決裁ブリーフ (PO に決裁を仰ぐ材料)。
 *     Draft の定義上まだ満たしていないのが正常な項目。
 *   - 載せない (= Draft でも enforce): 本文の体裁 / 事実性の検査。
 *     必須セクション網羅・AC 4 列・禁止語・mojibake・変更タイプ・CONFLICTING・hotfix env 配布証跡。
 *     これらは「Ready かどうか」と無関係に常に正しくあるべきで、Draft のうちに直すほど安い。
 *     特に禁止語 / mojibake / CONFLICTING は放置するほど是正コストが上がるため Draft でも止める。
 *
 * **Ready 化の瞬間に必ず検査される**ことは変わらない (Ready 後の push / `npm run pre-ready`
 * Step 9 / CI PR body gate はいずれも Draft ではないので本 deferral が効かない)。
 *
 * @type {ReadonlyArray<{ id: string; name: string; issue: string }>}
 */
/**
 * hard-fail する検査の一覧 (#4121 決裁 4、ADR-0007 §1-2 判断原則 v2)。
 *
 * ## なぜ既定を advisory 側に置くか
 *
 * 本 script は 26 の検査を持つが、その大半は **書式・網羅性 (類型 3)** であり、
 * 判断原則 v2 は「warn 降格 or 撤去」と定めている。にもかかわらず全部が hard-fail だったのは、
 * **1 本の script に 類型 1 と 類型 3 が同居し、script 単位で「pr-body は類型 1」と
 * 扱われていた**ため (#4121 Platform 計測)。統合 PR #3995 が 60 check 中 57 SUCCESS で
 * ありながら書式 gate 2 本により 4 日間 BLOCK された実害はこの構造から出ている。
 *
 * そこで **hard-fail する側を明示列挙し、列挙されていない検査は advisory** とする。
 * 既定を advisory に倒すのは、新しい検査を足すときに **hard-fail 化を明示的な意思決定**に
 * するため (装置の総数 ratchet と同型の力学、チーム憲章 §3.4 制約 1)。
 *
 * ## 各件が hard-fail である理由 (類型 1 = 証跡の真正性 / 不可逆な損失)
 *
 * advisory に落ちた検査は **消えていない**。違反は必ず出力され、AI レビュアと QM が読む。
 * 出力は `formatAdvisoryReport` が安定した 1 行 (`ADVISORY-IDS ...`) を含むため、
 * CI ログから機械的に拾える (#4121 AC7 の「warn の出口」)。
 *
 * ## advisory に落とした検査の多くは、別 job が単独で hard-fail を続ける
 *
 * 本 script は「PR body を見る検査」を 1 本に寄せ集めており、**同じ観点を専用 job も持っている**。
 * その重複分は本 script 側を advisory にしても gate は消えない (二重 gate が 1 本になるだけ):
 *
 * | 本 script の id | 引き続き hard-fail する job (script) |
 * |---|---|
 * | `missing-required-sections` | `pr-template-gate.yml`「必須セクションの存在確認」(`checkSectionPresence`) |
 * | `change-type-unselected` | 同「変更タイプの選択」(`checkChangeType`) |
 * | `ac-map-missing` / `-empty` / `-incomplete` | `pr-ac-verification-check.yml`「Verify AC map in PR body」(`checkPerPrAcMap`) |
 * | `unchecked-ready-checklist` | `pr-merge-gate.yml`「PR チェックリスト完了確認」(`checkMergeGateChecklist`) |
 *
 * 残り (mojibake / placeholder 各種 / forbidden-terms / hotfix env 節 / mergeable-conflicting) は
 * 本 script が唯一の検出点なので、**真に advisory になる**。うち `mergeable-conflicting` は
 * GitHub 本体が conflict した PR の merge を拒否するため、gate としては元々冗長だった。
 */
export const BLOCKING_GATES = [
	{
		id: 'evidence-pr-mismatch',
		name: 'AC 根拠の PR 番号が自 PR と一致',
		issue: '#4074',
		why: '証跡の宛先違い。別 PR / 存在しない番号を指した根拠はその PR を検証した証拠にならない (ADR-0004 が hard-fail 維持と明記)',
	},
	{
		id: 'closes-not-landed',
		name: '下書きの close 宣言が実 body に着地済み',
		issue: '#4170',
		why: '不可逆。閉じてはいけない Issue が main 反映で auto-close されると、後から静かには戻せない',
	},
	{
		id: 'self-review-evidence-missing',
		name: 'Self-Review の [x] に検証コマンド証跡がある',
		issue: '#3899',
		why: '証跡なき PASS は false PASS と同等 (docs/operations/self-review-agent.md §2.4)。自己申告だけで [x] が立つ経路を残さない',
	},
	{
		id: 'po-decision-brief-missing-section',
		name: 'PO 決裁ブリーフ (見出し)',
		issue: '#3962',
		why: '不可逆な変更 (DB schema / Stripe / auth / infra) を PO 決裁を経ずに通す = 自己承認。#3944 / #3956 で 2 回連続再発し ADR-0061 same-class-N→guard で gate 化したばかり',
	},
	{
		id: 'po-decision-brief-missing-diagram',
		name: 'PO 決裁ブリーフ (mermaid)',
		issue: '#3962',
		why: '同上。図が無いブリーフは PO が 5 秒で判断できず、決裁が形骸化する',
	},
	{
		id: 'po-decision-brief-unfilled-placeholder',
		name: 'PO 決裁ブリーフ (未置換プレースホルダ)',
		issue: '#3962',
		why: '同上。`___` が残ったブリーフは「出したが中身が無い」= 証跡の偽装に等しい',
	},
	{
		id: 'integration-evidence-missing',
		name: '統合 PR のマージ判定エビデンス表',
		issue: '#2945',
		why: 'main 反映は不可逆。統合 gate は監査の職掌 (audit-team.md §3.5) であり、本 script の書式整理とは別系統のため現状維持',
	},
];

/** @type {ReadonlySet<string>} */
export const BLOCKING_VIOLATION_IDS = new Set(BLOCKING_GATES.map((g) => g.id));

/**
 * violations を hard-fail (blocking) と advisory に分ける (#4121 決裁 4)。
 *
 * @template {{ id: string }} T
 * @param {T[]} violations
 * @returns {{ blocking: T[]; advisory: T[] }}
 */
export function partitionBySeverity(violations) {
	/** @type {T[]} */
	const blocking = [];
	/** @type {T[]} */
	const advisory = [];
	for (const v of violations) {
		if (BLOCKING_VIOLATION_IDS.has(v.id)) blocking.push(v);
		else advisory.push(v);
	}
	return { blocking, advisory };
}

/**
 * advisory 違反の出力行を組み立てる (#4121 AC7「warn の出口」)。
 *
 * **`ADVISORY-IDS` 行を必ず 1 行で出す**。降格した検査が誰にも読まれないまま放置されるのを
 * 防ぐには「何が何回 warn を出したか」を後から数えられる必要があるが、そのために新しい記録装置を
 * 作るのは装置 ratchet に反する (チーム憲章 §3.4 制約 1)。既存の CI ログに安定した書式で
 * 出しておけば、月次棚卸しで `grep ADVISORY-IDS` して数えられる。
 *
 * @param {{ id: string; message: string; issue?: string }[]} advisory
 * @returns {string[]}
 */
export function formatAdvisoryReport(advisory) {
	if (advisory.length === 0) return [];
	const lines = [
		`[check-pr-body] ADVISORY — ${advisory.length} 件 (merge は止めません。AI レビュアと QM が読む対象です、#4121)`,
		`[check-pr-body] ADVISORY-IDS ${advisory.map((v) => v.id).join(',')}`,
		'',
	];
	for (const v of advisory) {
		lines.push(`⚠ [${v.id}] (${v.issue ?? '-'})`);
		lines.push(`  ${v.message.split('\n').join('\n  ')}`);
		lines.push('');
	}
	lines.push(
		'  ※ advisory は「検査していない」ではなく「検出したが merge を止めない」です。',
		'     2 run 連続で誰も対応しなかった advisory は削除候補として棚卸しに上げてください (#4121 AC7)。',
	);
	return lines;
}

export const READY_ONLY_GATES = [
	{
		id: 'unchecked-ready-checklist',
		name: 'Ready for Review / 完了チェックリスト 全 [x]',
		issue: '#1481',
	},
	{
		id: 'po-decision-brief-missing-section',
		name: 'PO 決裁ブリーフ (見出し欠落)',
		issue: '#3962',
	},
	{
		id: 'po-decision-brief-missing-diagram',
		name: 'PO 決裁ブリーフ (mermaid 欠落)',
		issue: '#3962',
	},
	{
		id: 'po-decision-brief-unfilled-placeholder',
		name: 'PO 決裁ブリーフ (未置換プレースホルダ)',
		issue: '#3962',
	},
];

/** @type {ReadonlySet<string>} */
export const READY_ONLY_VIOLATION_IDS = new Set(READY_ONLY_GATES.map((g) => g.id));

/**
 * `gh pr view <num> --json isDraft` で Draft 状態を取得する (#3997)。
 *
 * `--jq` は使わない (#3962 の Windows cmd.exe 引用問題と同じ理由)。
 * 取得不能 (gh 未認証 / オフライン / PR 未作成) は `null` を返し、呼び出し側は
 * **Ready 扱い (= 全 gate enforce)** に倒す。gate が緩む方向へ黙って倒れないための fail-closed。
 *
 * @param {string|number|null} prNumber
 * @returns {boolean | null} 取得できなければ null (= 未解決)
 */
function fetchPrIsDraft(prNumber) {
	if (!prNumber) return null;
	try {
		const raw = execSync(`gh pr view ${prNumber} --json isDraft`, {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000,
		});
		return extractIsDraft(raw);
	} catch {
		return null;
	}
}

/**
 * `gh pr view --json isDraft` の生 JSON から boolean を取り出す (#3997)。
 * boolean 以外 / パース不能は `null` (= 未解決)。false に潰すと「Draft ではない」と
 * 「読めなかった」が混ざるため、`extractLabelNames` と同じ方針で分離する。
 *
 * @param {string} raw
 * @returns {boolean | null}
 */
export function extractIsDraft(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw.trim() || 'null');
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	return typeof parsed.isDraft === 'boolean' ? parsed.isDraft : null;
}

/**
 * 検査対象が Draft PR かを確定する (#3997)。
 *
 * - `--pr` 指定時は **gh の実状態だけ**を採用する (`--draft` フラグは無視)。
 *   フラグで Ready PR の Ready 化要件を外せると、それ自体が bypass 経路になるため。
 * - `--pr` なし (`--body-file` dry-run) では `--draft` フラグの申告を採用する。
 *   この経路には Ready 化する PR が存在しないので、緩める対象がそもそも無い。
 * - 未解決 (gh 失敗 / 申告なし) は **Ready 扱い** (= 従来どおり全 gate enforce)。
 *
 * @param {{ pr: string | null; draft: boolean }} args
 * @param {boolean | null} fetched `fetchPrIsDraft()` の戻り (未解決なら null)
 * @returns {{ isDraft: boolean; source: 'gh' | 'flag' | 'unresolved' }}
 */
export function resolveDraftState(args, fetched) {
	if (args.pr) {
		if (fetched === null) return { isDraft: false, source: 'unresolved' };
		return { isDraft: fetched, source: 'gh' };
	}
	if (args.draft) return { isDraft: true, source: 'flag' };
	return { isDraft: false, source: 'unresolved' };
}

// ---------------------------------------------------------------------------
// lane 解決 (#4130)
// ---------------------------------------------------------------------------

/**
 * `gh pr view --json baseRefName,headRefName,author` の生 JSON から lane 判定入力を取り出す (#4130)。
 *
 * 取り出せない形 (パース不能 / field 欠落) は **既定 lane に潰さず `null`**。
 * 「feature だった」と「読めなかった」を混ぜると、統合 PR を feature 判定して
 * 本 Issue の恒常赤をそのまま再現してしまう (`extractLabelNames` と同じ方針)。
 *
 * lane 判定そのものは `scripts/pr-lane.mjs` の `classifyLane` (SSOT) が行い、
 * 本関数は入力の取り出しだけを担う (判定の二重実装をしない、#4130 案 B)。
 *
 * @param {string} raw
 * @returns {{ baseRef: string; headRef: string; actor: string } | null}
 */
export function extractLaneRefs(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw.trim() || 'null');
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const baseRef = typeof parsed.baseRefName === 'string' ? parsed.baseRefName : null;
	const headRef = typeof parsed.headRefName === 'string' ? parsed.headRefName : null;
	// PR の lane は「このイベントを起こした人」ではなく **PR 作成者**で決める (#4133 と同じ理由)。
	const actor = typeof parsed.author?.login === 'string' ? parsed.author.login : null;
	if (baseRef === null || headRef === null || actor === null) return null;
	return { baseRef, headRef, actor };
}

/**
 * `gh pr view <num> --json baseRefName,headRefName,author` で lane を取得する (#4130)。
 * `--jq` は使わない (#3962 の Windows cmd.exe 引用問題と同じ理由)。
 *
 * @param {string|number|null} prNumber
 * @returns {'feature'|'integration'|'hotfix'|'dependabot'|null} 取得できなければ null (= 未解決)
 */
function fetchPrLane(prNumber) {
	if (!prNumber) return null;
	try {
		const raw = execSync(`gh pr view ${prNumber} --json baseRefName,headRefName,author`, {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 15_000,
		});
		const refs = extractLaneRefs(raw);
		return refs === null ? null : classifyLane(refs);
	} catch {
		return null;
	}
}

/**
 * 検査に使う lane を確定する (#4130)。
 *
 * - `--pr` 指定時は **gh の実 lane を優先**する (取得できた場合 `--lane` 申告は無視)。
 *   申告で lane を上書きできると、統合 PR を feature と偽って AC マップ検査を外す /
 *   feature PR を integration と偽って変更タイプ検査を外す、という bypass 経路になる
 *   (`resolveDraftState` の `--draft` と同じ方針)。
 * - `--pr` 指定で未解決 (gh 未認証 / オフライン / 出力形式変化) は、`--lane` 明示があれば
 *   それを逃げ道として採用し、無ければ **error** にする。
 *   ここで既定 lane に黙って倒すと、誤った lane で「体裁は緑」の検査結果が出る。
 *   どちらへ倒しても嘘になるため、無言では pass 側にも fail 側にも倒さない。
 * - `--pr` なし (`--body-file` dry-run) は `--lane` 申告を採用し、無指定は `feature` (後方互換)。
 *
 * @param {{ pr: string | null; lane: string | null }} args
 * @param {'feature'|'integration'|'hotfix'|'dependabot'|null} fetched `fetchPrLane()` の戻り
 * @returns {{ lane: string; source: 'gh' | 'flag' | 'default' } | { error: string }}
 */
export function resolveLane(args, fetched) {
	if (args.lane !== null && args.lane !== undefined && !VALID_LANES.includes(args.lane)) {
		return {
			error:
				`--lane の値が不正です: ${JSON.stringify(args.lane)}\n` +
				`  有効値: ${VALID_LANES.join(' / ')} (判定 SSOT: scripts/pr-lane.mjs)`,
		};
	}
	if (args.pr) {
		if (fetched !== null) return { lane: fetched, source: 'gh' };
		// gh から取れなかったときに限り、明示 --lane を逃げ道として認める (オフライン検証用)。
		// gh が取れているときは申告を無視するので、これは bypass 経路にならない。
		if (args.lane) return { lane: args.lane, source: 'flag' };
		return {
			error:
				`PR #${args.pr} の lane (base / head / author) を取得できませんでした ` +
				`(gh 未認証 / オフライン / timeout など)。\n` +
				`  lane が分からないまま検査すると、統合 PR を feature 用 template で見る (= 恒常赤、#4130) か\n` +
				`  feature PR を統合 PR 用の観点で見る (= 検査が緩む) かのどちらかになるため中断します。\n` +
				`  対応: gh auth status を確認して再実行するか、--lane <${VALID_LANES.join('|')}> を明示してください。`,
		};
	}
	if (args.lane) return { lane: args.lane, source: 'flag' };
	return { lane: 'feature', source: 'default' };
}

/**
 * 「`--pr` があるなら gh を必ず引く」という **配線そのもの**を 1 箇所に固定する (#4130 QA 指摘)。
 *
 * `resolveLane` が「取得できた gh を優先する」と正しく書けていても、呼び出し側で
 * `args.pr && args.lane === null ? fetch(...) : null` のように **申告があるときに fetch を省く**
 * 配線をすると、gh を引かない → `fetched === null` → 申告採用、となって bypass 経路が生まれる
 * (本 Issue の実装途中で実際に 1 度この形になった)。fetcher を引数で受けることで、
 * この 1 行を unit test で pin できるようにする。
 *
 * @param {{ pr: string | null; lane: string | null }} args
 * @param {(pr: string) => 'feature'|'integration'|'hotfix'|'dependabot'|null} fetchLane
 * @returns {{ lane: string; source: 'gh' | 'flag' | 'default' } | { error: string }}
 */
export function resolveLaneWithFetcher(args, fetchLane) {
	return resolveLane(args, args.pr ? fetchLane(args.pr) : null);
}

/**
 * `resolveDraftState` 版の同型 wrapper (#4130 QA 指摘)。
 * `--draft` 申告で Ready PR の Ready 化要件 (#3997) を外せないことは、
 * 「`--pr` があるなら isDraft を必ず引く」配線とセットで初めて保証される。
 *
 * @param {{ pr: string | null; draft: boolean }} args
 * @param {(pr: string) => boolean | null} fetchIsDraft
 * @returns {{ isDraft: boolean; source: 'gh' | 'flag' | 'unresolved' }}
 */
export function resolveDraftStateWithFetcher(args, fetchIsDraft) {
	return resolveDraftState(args, args.pr ? fetchIsDraft(args.pr) : null);
}

/** @typedef {{ id: string; issue: string; message: string }} Violation */

/**
 * violations を「Draft では deferred するもの」と「常に enforce するもの」に分ける (#3997)。
 * `isDraft` が false のときは deferred が必ず空 (= 従来の挙動と完全一致)。
 *
 * @param {Violation[]} violations
 * @param {boolean} isDraft
 * @returns {{ enforced: Violation[]; deferred: Violation[] }}
 */
export function partitionReadyOnlyViolations(violations, isDraft) {
	if (!isDraft) return { enforced: violations, deferred: [] };
	const enforced = [];
	const deferred = [];
	for (const v of violations) {
		if (READY_ONLY_VIOLATION_IDS.has(v.id)) deferred.push(v);
		else enforced.push(v);
	}
	return { enforced, deferred };
}

/**
 * Draft のため deferred した gate を明示する出力行を組み立てる (#3997 AC3)。
 *
 * **違反が 0 件でも必ず出す**。無言で緩めると「Draft のときだけ gate が空振りする」形になり、
 * #3969 (gate が生きているつもりで死んでいた) と同じ class になるため。
 *
 * @param {{ id: string; message: string }[]} deferred
 * @param {string|number|null} prNumber
 * @returns {string[]}
 */
export function formatDraftDeferredGates(deferred, prNumber = null, reason = 'draft') {
	const target = prNumber ? `PR #${prNumber}` : 'この PR';
	const head =
		reason === 'skip-flag'
			? `[check-pr-body] NOTE: ${target} は --skip-ready-only 指定のため Ready 化要件 ${READY_ONLY_GATES.length} 件を検査しませんでした (#4121)`
			: `[check-pr-body] NOTE: ${target} は Draft のため Ready 化要件 ${READY_ONLY_GATES.length} 件を deferred しました (#3997)`;
	const perGateSuffix =
		reason === 'skip-flag'
			? '未達 (本呼び出しでは fail させない)'
			: '未達 (Draft のため今回は fail させない)';
	const tail =
		reason === 'skip-flag'
			? `  ※ 同 section は pr-merge-gate.yml (check-merge-gate-checklist) が CI で検査します`
			: `  ※ Ready 化 (gh pr ready) 後の push / npm run pre-ready / CI では上記が全て必須になります`;
	return [
		head,
		...READY_ONLY_GATES.map((g) => {
			const hit = deferred.find((d) => d.id === g.id);
			return `  - ${g.name} (${g.issue}) — ${hit ? perGateSuffix : '現時点で違反なし'}`;
		}),
		tail,
	];
}

// ---------------------------------------------------------------------------
// CLI 引数パース
// ---------------------------------------------------------------------------

/**
 * `--name value` / `--name=value` / `-n value` の汎用 string パーサ。
 * 該当したら新しい index と value を返す。該当しなければ null。
 *
 * @param {string[]} argv
 * @param {number} i
 * @param {string[]} aliases
 * @returns {{ nextIndex: number; value: string | null } | null}
 */
function tryParseStringArg(argv, i, aliases) {
	const a = argv[i] ?? '';
	for (const alias of aliases) {
		if (a === alias) {
			return { nextIndex: i + 1, value: argv[i + 1] ?? null };
		}
		const prefix = `${alias}=`;
		if (a.startsWith(prefix)) {
			return { nextIndex: i, value: a.slice(prefix.length) };
		}
	}
	return null;
}

/**
 * @param {string[]} argv
 * @returns {{ pr: string | null; bodyFile: string | null; labels: string | null; lane: string | null; verifyClosesLanded: string | null; noLabels: boolean; skipMergeable: boolean; draft: boolean; skipReadyOnly: boolean; help: boolean }}
 */
export function parseArgs(argv) {
	/** @type {{ pr: string | null; bodyFile: string | null; labels: string | null; lane: string | null; verifyClosesLanded: string | null; noLabels: boolean; skipMergeable: boolean; draft: boolean; skipReadyOnly: boolean; help: boolean }} */
	const args = {
		pr: null,
		bodyFile: null,
		labels: null,
		lane: null,
		verifyClosesLanded: null,
		noLabels: false,
		skipMergeable: false,
		draft: false,
		skipReadyOnly: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const pr = tryParseStringArg(argv, i, ['--pr', '-p']);
		if (pr) {
			args.pr = pr.value;
			i = pr.nextIndex;
			continue;
		}
		const bodyFile = tryParseStringArg(argv, i, ['--body-file']);
		if (bodyFile) {
			args.bodyFile = bodyFile.value;
			i = bodyFile.nextIndex;
			continue;
		}
		const labels = tryParseStringArg(argv, i, ['--labels']);
		if (labels) {
			args.labels = labels.value;
			i = labels.nextIndex;
			continue;
		}
		// #4130: --pr 指定時は gh の実 lane が優先され、本フラグは無視される (bypass 防止)
		const lane = tryParseStringArg(argv, i, ['--lane']);
		if (lane) {
			args.lane = lane.value;
			i = lane.nextIndex;
			continue;
		}
		// #4170 AC2: 下書き body の Closes 宣言が実 PR body に着地しているかだけを検査する専用モード
		const closesLanded = tryParseStringArg(argv, i, ['--verify-closes-landed']);
		if (closesLanded) {
			args.verifyClosesLanded = closesLanded.value;
			i = closesLanded.nextIndex;
			continue;
		}
		const a = argv[i];
		if (a === '--skip-mergeable') args.skipMergeable = true;
		else if (a === '--no-labels') args.noLabels = true;
		// #3997: --pr 指定時は gh の isDraft が優先され、本フラグは無視される (bypass 防止)
		else if (a === '--draft') args.draft = true;
		else if (a === '--skip-ready-only') args.skipReadyOnly = true;
		else if (a === '--help' || a === '-h') args.help = true;
	}
	return args;
}

function printHelp() {
	console.log(`
check-pr-body.mjs — PR body のセルフチェック (Issue #1775 AC2)

Usage:
  node scripts/check-pr-body.mjs --pr <number>
  node scripts/check-pr-body.mjs --pr <number> --skip-mergeable
  node scripts/check-pr-body.mjs --pr <number> --body-file <path> --skip-mergeable
  node scripts/check-pr-body.mjs --body-file <path> --no-labels          # PR 未作成の dry-run
  node scripts/check-pr-body.mjs --body-file <path> --labels priority:critical,hotfix

label の解決方法 (#3962):
  label 条件付き gate (hotfix env 配布証跡 #2343 / PO 決裁ブリーフ #3962) が黙って
  skip されるのを防ぐため、label が解決できない呼び出しは exit 2 で中断する (fail-closed)。
  PR 番号が取れるなら --pr を渡すこと。--no-labels / --labels は PR 作成前の dry-run 専用で、
  どちらも「発火しなかった label 条件付き gate」を SKIPPED 行として出力する (#3983)。
  空の --labels ("" / " , ") は沈黙 fail-open になるため exit 2 で中断する (#3983)。

Options:
  --pr <num>          GitHub PR 番号 (gh pr view で body 取得 + label 自動検出)
  --body-file <path>  ローカルファイルから body を読む（PR 未作成時の dry-run 用）
  --labels <csv>      PR ラベルをカンマ区切りで明示指定（--body-file 時の hotfix 検出用、#2343）
                      空文字は不可 — label 0 件の明示は --no-labels を使う (#3983)
  --no-labels         label が 1 件も無いことを明示（--body-file dry-run 用、#3962）
  --draft             Draft 相当として検査（--body-file dry-run 専用、#3997）
                      --pr 指定時は gh pr view --json isDraft の実状態が優先され本フラグは無視される
  --skip-ready-only   Ready 化要件 ${READY_ONLY_GATES.length} 件を検査しない (#4121、push レイヤ専用)
                      同 section は pr-merge-gate.yml が CI で検査するため純粋な重複。
                      skip したことは必ず標準出力に出る (無言 skip にしない)
  --lane <lane>       検査観点の lane (${VALID_LANES.join(' | ')}、#4130)
                      --pr 指定時は gh の base/head/author から自動判定され本フラグは無視される
                      (gh が取得できない場合のみ逃げ道として採用される)
  --skip-mergeable    GitHub API 呼び出しをスキップ (オフライン環境用)
  --verify-closes-landed <path>
                      【専用モード】手元の下書き <path> の \`Closes #N\` が GitHub 上の実 PR body に
                      着地しているかだけを検査する (#4170 AC2、--pr 必須)。他の検査は走らない。
                      下書きだけ編集して \`gh pr edit --body-file\` を流し忘れた状態 (= 書いたつもり)
                      と、撤回したはずの宣言が実 body に残っている状態の両方を落とす。
                      required CI には載せない — approve 直前に 1 回叩く手動 gate。
  --help, -h          このヘルプを表示

Detected violations:
  1. 必須セクション見出しの欠落 / 表記揺れ（PR template SSOT）
  2. 禁止語 (${FORBIDDEN_TERMS.join(' / ')}) の混入（コメント以外）
  3. AC 検証マップの 4 列未記入 (skip マーカー時を除く)
  4. Ready for Review / 完了チェックリストの未チェック残置
  5. PR が CONFLICTING (--pr 指定時)
  6. hotfix label PR (${HOTFIX_LABELS.join(' / ')}) で ADR-0006 配布証跡欄が空 (#2343)
  7. PR body の文字化け (BOM / \`??\` 5 件以上) — heredoc 由来 cp932 mojibake (#2562 / #2576)
  8. 変更タイプ checkbox 未選択 (\`- [x]\` 1 つ以上必須、CI gate「変更タイプの選択」と同一 SSOT、#3846)
  9. 未置換プレースホルダ (${PLACEHOLDER_PATTERNS.map((p) => p.label).join(' / ')}) が body のどこかに残存 (code fence 内も対象、#4002 / #4029)
     正当にプレースホルダ文字列を書く PR は \`<!-- placeholder-scan-skip: 理由 -->\` を body に 1 行書く (label では通らない)

lane による観点の切替 (#4130):
  統合 PR (release/* → main、lane=integration) は単一 Issue に紐づかず feature 用 template を
  持たないため、feature 用の必須セクション / AC 検証マップ / 変更タイプを要求すると
  **body の内容にかかわらず必ず fail** する (実測: PR #4126)。lane=integration では
  .github/INTEGRATION_PR_TEMPLATE.md を参照し、AC 検証マップの代わりに
  「マージ判定エビデンス表 + 残 NG 0 件」を検証する (検査を外すのではなく観点を切替える)。
  禁止語 / mojibake / 未置換プレースホルダ / label 条件付き gate は全 lane 共通で効く。

blocking / advisory の切り分け (#4121 決裁 4、ADR-0007 §1-2 判断原則 v2):
  **merge を止めるのは 類型 1 (証跡の真正性 / 不可逆な損失) の ${BLOCKING_GATES.length} 件だけ**:
${BLOCKING_GATES.map((g) => `    - ${g.id} (${g.issue}) — ${g.why}`).join('\n')}

  これ以外の検査 (書式・網羅性 = 類型 3) は **advisory**。検出して必ず出力するが exit code に
  影響させない。「検査していない」のではなく「検出したが merge を止めない」であり、内容の妥当性は
  AI レビュアと QM が読んで判断する。

  advisory は \`ADVISORY-IDS <id,id,...>\` の 1 行を必ず出す。**2 run 連続で誰も対応しなかった
  advisory は削除候補**として棚卸しに上げる (#4121 AC7)。記録用の新しい装置は作らない —
  CI ログを \`grep ADVISORY-IDS\` して数える。

  新しい検査を足すときの既定は advisory。hard-fail にしたいなら BLOCKING_GATES に
  「何を守るか (類型 1 のどれか)」を書いて明示的に足す。

Draft PR の扱い (#3997):
  Draft PR では Ready 化要件 ${READY_ONLY_GATES.length} 件 (${READY_ONLY_GATES.map((g) => g.id).join(' / ')})
  のみ deferred する。それ以外 (必須セクション / AC 4 列 / 禁止語 / mojibake / 変更タイプ / CONFLICTING /
  hotfix env 配布証跡) は Draft でも従来どおり fail させる。deferred したことは必ず標準出力に出る。

Exit codes:
  0 = OK
  1 = 違反検出
  2 = internal error
`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/**
 * args に基づき PR body を取得する。失敗時は { body: null, exitCode } を返す。
 * @param {{ bodyFile: string | null; pr: string | null }} args
 * @returns {{ body: string | null; exitCode: number }}
 */
function loadPrBody(args) {
	if (args.bodyFile) {
		if (!existsSync(args.bodyFile)) {
			console.error(`[check-pr-body] ERROR: --body-file が存在しません: ${args.bodyFile}`);
			return { body: null, exitCode: 2 };
		}
		return { body: readFileSync(args.bodyFile, 'utf-8'), exitCode: 0 };
	}
	if (args.pr) {
		try {
			return { body: fetchPrBody(args.pr), exitCode: 0 };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`[check-pr-body] ERROR: gh pr view で body 取得失敗: ${msg}`);
			return { body: null, exitCode: 2 };
		}
	}
	console.error('[check-pr-body] ERROR: --pr <number> または --body-file <path> が必要です');
	printHelp();
	return { body: null, exitCode: 2 };
}

/**
 * PR body と template から全違反リストを計算する。
 * @param {string} body
 * @param {string[]} requiredSections
 * @param {string} template `.github/PULL_REQUEST_TEMPLATE.md` の内容 (#3846 変更タイプ検証で使用)
 * @param {{ pr: string | null; skipMergeable: boolean; labels?: string[] | null; lane?: string | null; noLabels?: boolean }} args
 * @param {string[]} notes skip 等の「検査しなかったこと」を呼び出し側で出力するための追記先 (#4029)
 * @returns {{ id: string; issue: string; message: string }[]}
 */
export function collectViolations(body, requiredSections, template, args, notes = []) {
	const violations = [];
	const labels = args.labels ?? [];
	// #4130: 統合 PR (release/* → main) は単一 Issue に紐づかないため、per-PR AC マップ /
	// 変更タイプ checkbox を持たない別系統の body になる。観点を切替えるだけで検査は外さない。
	const isIntegration = args.lane === 'integration';

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

	if (isIntegration) {
		// #4130 AC2: per-PR AC マップの代わりに「マージ判定エビデンス表 + 残 NG 0 件」を検証する。
		// 判定は pr-ac-verification-check.yml と同一 SSOT (scripts/check-ac-verification-map.mjs) を
		// 再利用し、本 CLI 側に同じ表検証を書かない (#4130 案 C = 別 CLI 新設 を採らない理由)。
		const evidence = checkIntegrationEvidenceTable(body);
		if (!evidence.ok) {
			violations.push({
				id: 'integration-evidence-missing',
				issue: '#2945/#4130',
				message: evidence.error ?? 'マージ判定エビデンス表の検証に失敗しました',
			});
		}
		// #4170 AC3: 本文が主張する件数と表の行数の一致 (純粋関数、network 不要)
		const countDrift = checkClaimedCounts(body);
		if (countDrift) violations.push({ ...countDrift, issue: '#4170 AC3' });

		// #4170 AC1: 本文の state / label 主張を GitHub 実測と突合。
		// **integration lane のみ hard-fail** (AC4)。feature lane の挙動は変えない。
		// `--no-labels` / `--labels` は「label を手で主張した」経路なので、実測を伴う本検査は
		// 走らせない (手元主張と実測の混在は判定の意味を壊す)。skip したことは notes に出す。
		const stateClaims = extractStateClaims(body);
		if (stateClaims.length === 0) {
			notes.push('[check-pr-body] NOTE: 本文に state / label の主張が無いため #4170 AC1 は対象外');
		} else if (args.noLabels || args.labels !== null) {
			notes.push(
				`[check-pr-body] SKIP: #4170 AC1 (state / label 実測突合) — ` +
					`--no-labels / --labels 指定時は実測を引かないため。主張 ${stateClaims.length} 件は未検証です`,
			);
		} else {
			const live = fetchIssueStates(stateClaims.map((c) => c.number));
			const stateDrift = checkStateClaims(body, live);
			if (stateDrift) violations.push({ ...stateDrift, issue: '#4170 AC1' });
			notes.push(
				`[check-pr-body] NOTE: #4170 AC1 — 本文の state / label 主張 ${stateClaims.length} 件を実測と突合しました ` +
					`(実測取得: ${live.size} 件)`,
			);
		}

		notes.push(
			'[check-pr-body] NOTE: lane=integration のため AC 検証マップの代わりに ' +
				'「マージ判定エビデンス表 + 残 NG 0 件」を検証しました (#4130 AC2)',
			'  - 変更タイプ checkbox (#3846) は統合 PR template に当該 section が無いため検査対象外です (#4130 AC3)',
			'  - Ready for Review / 完了チェックリストも統合 PR template に無いため、' +
				'統合 PR の checklist は pr-merge-gate.yml (## NG 0 件 / カバレッジ宣言) が検査します',
		);
	} else {
		const acMap = checkAcMap(body);
		if (acMap) violations.push({ ...acMap, issue: '#1775 AC2' });

		// #4074: 根拠欄の `--pr <番号>` が自 PR を指しているか (宛先違いの証跡を通さない)
		const evidencePrRef = checkEvidencePrReferences(body, args.pr);
		if (evidencePrRef) violations.push({ ...evidencePrRef, issue: '#4074' });
	}

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

	if (args.pr && !args.skipMergeable) {
		const mergeable = checkMergeable(args.pr);
		if (mergeable) violations.push({ ...mergeable, issue: '#1672/#1675/#1718/#1753' });
	}

	// #2343: hotfix label PR の配布証跡欄強化チェック
	const hotfixEnvCheck = checkEnvDistributionForHotfix(body, labels);
	if (hotfixEnvCheck) violations.push({ ...hotfixEnvCheck, issue: '#2343' });

	// #4029: 未置換プレースホルダ検出 (body 全体 / code fence 内も対象)
	const placeholders = checkPlaceholders(body);
	notes.push(...placeholders.notes);
	if (placeholders.violation) violations.push({ ...placeholders.violation, issue: '#4002/#4029' });

	// #2562 / #2576: PR body 文字化け検出 (BOM / `??` heuristic)
	const mojibake = detectMojibake(body);
	for (const m of mojibake) {
		violations.push({ ...m, issue: '#2562/#2576' });
	}

	// #2475 Phase 2 / #2815 D-1: Self-Review 証跡なき [x] 自己宣言の検出 (PO 判断 2026-06-04)
	const selfReviewEvidence = checkSelfReviewEvidence(body);
	if (selfReviewEvidence) {
		violations.push({ ...selfReviewEvidence, issue: '#2475/#2815 D-1' });
	}

	// #3962: po-decision:required label と PO 決裁ブリーフの対応固定 (#3944 / #3956 同型の再発防止)
	const poDecision = checkPoDecisionBrief(body, labels);
	if (poDecision) violations.push({ ...poDecision, issue: '#3944/#3956/#3962' });

	// #3846: 変更タイプ checkbox 未選択の shift-left 検出 (CI gate と同一 SSOT を再利用)
	// #4130 AC3: 統合 PR template は `## 変更タイプ` を持たないため integration lane では検査しない
	// (統合 template を渡すと detectChangeTypeHeading が別 section を変更タイプと誤認する)。
	if (!isIntegration) {
		const changeType = checkChangeTypeSelection(body, template, labels);
		if (changeType) {
			violations.push({ ...changeType, issue: '#3835/#3837/#3844/#3846' });
		}
	}

	return violations;
}

/**
 * `--verify-closes-landed <下書きパス>` 専用モード (#4170 AC2)。
 *
 * 通常の body 検査 (必須セクション / 禁止語 / …) とは問いが違う (「body の中身が正しいか」ではなく
 * 「手元の下書きが GitHub に着地しているか」) ため、`collectViolations` に混ぜず独立させる。
 * required CI には載せない — approve 直前に 1 回だけ叩く手動 gate であり、本文修正のたびに
 * 重量レーンを回すのは監査 run の CI 待ちを悪化させる (#4171、監査チーム判断 2026-08-01)。
 *
 * @param {{ pr: string | null; verifyClosesLanded: string | null }} args
 * @param {(pr: string) => string} fetchBody 実 PR body 取得 (test で差し替え可能)
 * @returns {number} exit code
 */
export function runClosesLandedMode(args, fetchBody = fetchPrBody) {
	const draftPath = args.verifyClosesLanded ?? '';
	if (!args.pr) {
		console.error(
			'[check-pr-body] ERROR: --verify-closes-landed は --pr <number> と併用してください ' +
				'(GitHub 上の実 PR body と比較するため)。',
		);
		return 2;
	}
	if (!existsSync(draftPath)) {
		console.error(`[check-pr-body] ERROR: 下書きファイルが存在しません: ${draftPath}`);
		return 2;
	}
	const claimedBody = readFileSync(draftPath, 'utf-8');
	/** @type {string} */
	let liveBody;
	try {
		liveBody = fetchBody(args.pr);
	} catch (e) {
		// 取得できないまま pass 側に倒すと「検査したつもり」になる。fail-closed で中断する。
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[check-pr-body] ERROR: PR #${args.pr} の body を取得できませんでした: ${msg}`);
		return 2;
	}

	const landed = extractLandedClosingIssues(liveBody);
	const mentions = extractClosingKeywordMentions(liveBody);
	const naiveOnly = mentions.filter((n) => !landed.includes(n));
	console.log(
		`[check-pr-body] closes-landed: PR #${args.pr} の実 body / 下書き ${draftPath} を比較します`,
	);
	// grep 相当との差分を必ず出す。撤回済み言及を close 宣言と読み違える運用ミスを可視化するため
	// (#4170: 実測で `grep -c "Closes #4129"` は 4 件返すが実 close 宣言は 0 件だった)。
	console.log(
		`  実 body の close 宣言 (行頭一致 SSOT): ${landed.length === 0 ? '(なし)' : landed.map((n) => `#${n}`).join(' / ')}`,
	);
	console.log(
		naiveOnly.length === 0
			? '  grep 相当 (位置を問わない keyword 一致) との差分: なし'
			: `  grep 相当なら誤って拾う番号: ${naiveOnly.map((n) => `#${n}`).join(' / ')} ` +
					'(撤回経緯の言及等。auto-close は発火しないので close 宣言ではありません)',
	);

	const violation = checkClosesLanded(claimedBody, liveBody);
	if (!violation) {
		console.log('[check-pr-body] OK — 下書きの closing 宣言は全て GitHub 上の実 body に着地済み');
		return 0;
	}
	console.log(`[check-pr-body] FAIL — 1 件の違反:\n`);
	console.log(`✗ [${violation.id}] (#4170 AC2)`);
	console.log(`  ${violation.message.split('\n').join('\n  ')}\n`);
	return 1;
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return 0;
	}

	// #4170 AC2: 下書き vs 実 body の照合は独立した問い。通常の body 検査とは別モードで走る。
	if (args.verifyClosesLanded !== null) return runClosesLandedMode(args);

	const { body, exitCode } = loadPrBody(args);
	if (body === null) return exitCode;

	// #4130: lane を先に確定する (参照する template / 検証観点が lane で決まるため)。
	// --pr 指定時は gh の実 lane のみ採用し、未解決は fail-closed で中断する。
	const resolvedLane = resolveLaneWithFetcher(args, fetchPrLane);
	if ('error' in resolvedLane) {
		console.error(`[check-pr-body] ERROR: ${resolvedLane.error}`);
		return 2;
	}
	const { lane, source: laneSource } = resolvedLane;
	console.log(
		`[check-pr-body] lane=${lane} (判定元: ${laneSource}、SSOT: scripts/pr-lane.mjs) — ` +
			`参照 template: ${templatePathForLane(lane)
				.replace(repoRoot, '')
				.replace(/^[/\\]/, '')}`,
	);

	/** @type {{ template: string; requiredSections: string[] }} */
	let loaded;
	try {
		loaded = loadTemplateForLane(lane);
	} catch (e) {
		console.error(`[check-pr-body] ERROR: ${e instanceof Error ? e.message : String(e)}`);
		return 2;
	}
	const { template, requiredSections } = loaded;

	// #2343: hotfix label 検出のためラベル取得 / #3962: 未解決は fail-closed
	const needsFetch = args.labels === null && !args.noLabels;
	const resolved = resolveLabels(args, needsFetch ? fetchPrLabels(args.pr) : null);
	if ('error' in resolved) {
		console.error(`[check-pr-body] ERROR: ${resolved.error}`);
		return 2;
	}
	const labels = resolved.labels;

	// #3962 (QA 指摘) / #3983: skip した gate を通常 pass と見分けられる形で先に出す。
	// 対象は「label を手で主張した」経路 (--no-labels / --labels) の未発火 gate。
	const skippedLines = args.noLabels
		? formatSkippedLabelGates(labels, '--no-labels')
		: args.labels !== null
			? formatSkippedLabelGates(labels, '--labels')
			: [];
	for (const line of skippedLines) console.log(line);
	const skippedCount = skippedLines.length === 0 ? 0 : selectSkippedLabelGates(labels).length;

	/** @type {string[]} */
	const notes = [];
	const allViolations = collectViolations(
		body,
		requiredSections,
		template,
		{ ...args, labels, lane },
		notes,
	);
	for (const line of notes) console.log(line);

	// #3997: Draft PR では Ready 化要件のみ deferred。未解決 (gh 失敗) は Ready 扱いで全 enforce。
	const draftState = resolveDraftStateWithFetcher(args, fetchPrIsDraft);
	// #4121: `--skip-ready-only` は Draft/Ready を問わず Ready 化要件を検査対象から外す
	// (push レイヤ専用。CI は pr-merge-gate.yml が同 section を検査する)。
	const deferReadyOnly = draftState.isDraft || args.skipReadyOnly;
	const { enforced: violations, deferred } = partitionReadyOnlyViolations(
		allViolations,
		deferReadyOnly,
	);
	if (deferReadyOnly) {
		const reason = draftState.isDraft ? 'draft' : 'skip-flag';
		for (const line of formatDraftDeferredGates(deferred, args.pr, reason)) console.log(line);
	}

	// #4121 決裁 4: 類型 1 (証跡の真正性 / 不可逆) のみ merge を止める。
	// 類型 3 (書式・網羅性) は検出して出力するが exit code に影響させない。
	const { blocking, advisory } = partitionBySeverity(violations);
	for (const line of formatAdvisoryReport(advisory)) console.log(line);

	if (blocking.length === 0) {
		const draftNote = draftState.isDraft
			? ` (Draft のため Ready 化要件 ${READY_ONLY_GATES.length} 件は deferred)`
			: args.skipReadyOnly
				? ` (--skip-ready-only のため Ready 化要件 ${READY_ONLY_GATES.length} 件は未検査)`
				: '';
		const advisoryNote =
			advisory.length > 0 ? ` (advisory ${advisory.length} 件あり — 上記 ⚠ を確認)` : '';
		console.log(
			skippedCount > 0
				? `[check-pr-body] OK (label 条件付き gate ${skippedCount} 件は未検査)${draftNote}${advisoryNote} — blocking 違反なし`
				: `[check-pr-body] OK${draftNote}${advisoryNote} — blocking 違反なし`,
		);
		return 0;
	}

	console.log(`[check-pr-body] FAIL — blocking ${blocking.length} 件の違反:\n`);
	for (const v of blocking) {
		console.log(`✗ [${v.id}] (${v.issue})`);
		console.log(`  ${v.message.split('\n').join('\n  ')}\n`);
	}
	return 1;
}

// #3962 が本ファイルにインラインで入れた realpath 正規化は、#3969 で判定 SSOT
// (`scripts/lib/is-main.mjs`) に統合した。同じ判定を各 script が自前で持つ構造が
// 「6 方言のうち 40 箇所が無言 exit 0」の原因だったため、ここでは helper を使う。
const isMain = isMainModule(import.meta.url);

if (isMain) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error('[check-pr-body] internal error:', err);
			process.exit(2);
		});
}
