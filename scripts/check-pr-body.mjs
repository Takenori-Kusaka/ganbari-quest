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
import { isMain as isMainModule } from './lib/is-main.mjs';
import { checkChangeType } from './pr-template-gate-checks.mjs';

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
 * @type {ReadonlyArray<{ name: string; issue: string; label: string }>}
 */
export const LABEL_CONDITIONAL_GATES = [
	{
		name: 'hotfix env 配布証跡 (ADR-0006)',
		issue: '#2343',
		label: HOTFIX_LABELS.join(' / '),
	},
	{
		name: 'PO 決裁ブリーフ',
		issue: '#3962',
		label: PO_DECISION_LABEL,
	},
];

/**
 * `--no-labels` 指定時に「検査しなかった gate」を明示する出力行を組み立てる (#3962 QA 指摘)。
 *
 * 呼び出し側が `console.log` するだけで済むよう、行配列で返す。
 * 将来メッセージを整理した拍子に無言化しないよう、gate 名の出現を test で固定している ([LB7])。
 *
 * @returns {string[]}
 */
export function formatSkippedLabelGates() {
	return [
		`[check-pr-body] SKIPPED — label 条件付き gate ${LABEL_CONDITIONAL_GATES.length} 件は検査していません (--no-labels)`,
		...LABEL_CONDITIONAL_GATES.map((g) => `  - ${g.name} (${g.issue}) — 発火 label: ${g.label}`),
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
		return {
			labels: args.labels
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
		};
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
 * @returns {{ pr: string | null; bodyFile: string | null; labels: string | null; noLabels: boolean; skipMergeable: boolean; help: boolean }}
 */
function parseArgs(argv) {
	/** @type {{ pr: string | null; bodyFile: string | null; labels: string | null; noLabels: boolean; skipMergeable: boolean; help: boolean }} */
	const args = {
		pr: null,
		bodyFile: null,
		labels: null,
		noLabels: false,
		skipMergeable: false,
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
		const a = argv[i];
		if (a === '--skip-mergeable') args.skipMergeable = true;
		else if (a === '--no-labels') args.noLabels = true;
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
  PR 番号が取れるなら --pr を渡すこと。--no-labels は PR 作成前の dry-run 専用で、
  指定すると「検査しなかった gate」が SKIPPED 行として出力される。

Options:
  --pr <num>          GitHub PR 番号 (gh pr view で body 取得 + label 自動検出)
  --body-file <path>  ローカルファイルから body を読む（PR 未作成時の dry-run 用）
  --labels <csv>      PR ラベルをカンマ区切りで明示指定（--body-file 時の hotfix 検出用、#2343）
  --no-labels         label が 1 件も無いことを明示（--body-file dry-run 用、#3962）
  --skip-mergeable    GitHub API 呼び出しをスキップ (オフライン環境用)
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
 * @param {{ pr: string | null; skipMergeable: boolean; labels?: string[] }} args
 * @param {string[]} notes skip 等の「検査しなかったこと」を呼び出し側で出力するための追記先 (#4029)
 * @returns {{ id: string; issue: string; message: string }[]}
 */
function collectViolations(body, requiredSections, template, args, notes = []) {
	const violations = [];
	const labels = args.labels ?? [];

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

	const acMap = checkAcMap(body);
	if (acMap) violations.push({ ...acMap, issue: '#1775 AC2' });

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
	const changeType = checkChangeTypeSelection(body, template, labels);
	if (changeType) {
		violations.push({ ...changeType, issue: '#3835/#3837/#3844/#3846' });
	}

	return violations;
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help) {
		printHelp();
		return 0;
	}

	const { body, exitCode } = loadPrBody(args);
	if (body === null) return exitCode;

	if (!existsSync(TEMPLATE_PATH)) {
		console.error(`[check-pr-body] ERROR: PR template が見つかりません: ${TEMPLATE_PATH}`);
		return 2;
	}
	const template = readFileSync(TEMPLATE_PATH, 'utf-8');
	const requiredSections = extractRequiredSections(template);

	// #2343: hotfix label 検出のためラベル取得 / #3962: 未解決は fail-closed
	const needsFetch = args.labels === null && !args.noLabels;
	const resolved = resolveLabels(args, needsFetch ? fetchPrLabels(args.pr) : null);
	if ('error' in resolved) {
		console.error(`[check-pr-body] ERROR: ${resolved.error}`);
		return 2;
	}
	const labels = resolved.labels;

	// #3962 (QA 指摘): skip した gate を通常 pass と見分けられる形で先に出す。
	if (args.noLabels) {
		for (const line of formatSkippedLabelGates()) console.log(line);
	}

	/** @type {string[]} */
	const notes = [];
	const violations = collectViolations(
		body,
		requiredSections,
		template,
		{ ...args, labels },
		notes,
	);
	for (const line of notes) console.log(line);

	if (violations.length === 0) {
		console.log(
			args.noLabels
				? `[check-pr-body] OK (label 条件付き gate ${LABEL_CONDITIONAL_GATES.length} 件は未検査) — 違反なし`
				: '[check-pr-body] OK — 違反なし',
		);
		return 0;
	}

	console.log(`[check-pr-body] FAIL — ${violations.length} 件の違反:\n`);
	for (const v of violations) {
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
