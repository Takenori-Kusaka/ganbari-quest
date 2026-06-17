#!/usr/bin/env node
/**
 * scripts/pr-template-gate-checks.mjs — Issue #2944 (Phase A/A-2、親 #2942 / EPIC #2861)
 *
 * `.github/workflows/pr-template-gate.yml` の 5 job (必須セクション存在 / 関連 Issue 番号 /
 * 変更タイプ / 顧客価値 / テスト実行結果) の検証ロジックを **lane-aware な純粋関数**として
 * 集約した SSOT。各 job の `actions/github-script` に inline されていた判定を本 script に移し、
 * unit test (tests/unit/github/pr-template-gate-checks.test.ts) で 4 lane (feature /
 * integration / hotfix / dependabot) 全てを fixture 入力で検証可能にする (#2944 実装方針)。
 *
 * 【lane-aware 化の設計 (#2944 / #2942 選択肢 C)】
 *   - job は全 lane で **必ず実行** (`if:` で全体 skip しない = required check の空洞化禁止)。
 *   - lane 判定は `scripts/pr-lane.mjs` (A-1 SSOT) 経由のみ。本 script は lane を入力で受け取り、
 *     判定ロジックを inline 重複させない (#2944 no-go)。
 *   - `dependabot` lane は現行どおり全 check を skip 相当 (挙動不変、#2944 AC5)。
 *     → 各 check は lane==='dependabot' で { skipped:true } を返す (= 旧 actor 判定 skip と同義)。
 *   - `feature` / `hotfix` lane は **現行と完全同一の検証観点**を維持 (#2944 AC4 回帰ゼロ)。
 *   - `integration` lane (develop→main 統合 PR) のみ検証観点を差し替える (#2944 AC2/AC3):
 *       * issue-reference: `closes #<単一>` を必須にせず「含有 PR 一覧 (#NNNN 複数行) の存在」を検証。
 *       * change-type: 複数タイプ混在を許容 (1 つ以上 [x] は維持)。← feature と同じ閾値だが意味付けが異なる。
 *       * customer-value: per-PR 顧客価値でなく placeholder 残存検出のみ維持 (Phase B template で field 確定)。
 *       * test-results: per-PR コマンド結果でなく「統合エビデンス表 (マージ判定エビデンス) の存在」を検証。
 *       * section-presence: 統合 PR 用 section set (現行の部分集合 + エビデンス表 section 必須) で検証。
 *         Phase B (#2871) で PR_TEMPLATE_SECTIONS.integration.json を導入予定だが、本 phase では
 *         「統合 PR template 未導入なら暫定 section set」で動かす (#2944 no-go の Phase B 接続点)。
 *
 * 【各 check の戻り値 contract (job 側が exit code に変換)】
 *   { ok: boolean, skipped?: boolean, message: string, lane: string }
 *   - skipped===true   → job は success (検証対象外。dependabot / dependencies label / type:docs 等)
 *   - ok===true        → job は success (検証 PASS)
 *   - ok===false       → job は fail (core.setFailed 相当、message を出力)
 *
 * 【CLI (job から呼ぶ)】
 *   node scripts/pr-template-gate-checks.mjs --check section-presence --lane integration \
 *     --body-file <path> --labels-json <path> --template-file <path> --ssot-file <path>
 *   exit: 0 = ok/skipped、1 = 検証 fail、2 = 引数/内部エラー
 *
 * 純粋関数群 (本 file の export) は副作用ゼロ。fs 読み込み / process.exit は CLI entrypoint のみ。
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {'feature' | 'integration' | 'hotfix' | 'dependabot'} Lane
 * @typedef {{ ok: boolean, skipped?: boolean, message: string, lane: Lane }} CheckResult
 * @typedef {{
 *   body: string;
 *   labels: string[];
 *   template: string;
 *   ssotSections: string[] | null;
 *   lane: Lane;
 * }} CheckInput
 */

/**
 * 統合 PR (integration lane) で必須とする section set。
 * Phase B (#2871) で PR_TEMPLATE_SECTIONS.integration.json を導入するまでの暫定。
 * 現行 13 section の部分集合 (統合 PR が単一 Issue × per-PR AC 前提を満たせないため、
 * AC 検証マップ等の per-PR 前提 section を外す) + マージ判定エビデンス表 section を必須化。
 *
 * 「マージ判定エビデンス」は audit-team.md §3.5 のマージ判定エビデンス表を指す。本 phase では
 * 統合 PR template 未導入のため、現行 template に存在する section のうち統合 PR でも意味を持つ
 * ものに限定する。section 名は現行 PR_TEMPLATE_SECTIONS.json の表記に一致させる。
 *
 * @type {string[]}
 */
export const INTEGRATION_REQUIRED_SECTIONS = [
	'## 顧客価値・目的',
	'## 関連 Issue',
	'## 変更タイプ',
	'## テスト & 安全装置セルフチェック',
	'## レビュー依頼事項・破壊的変更',
	'## Ready for Review チェックリスト',
	'## QM レビュー結果',
];

/**
 * dependencies label による skip 条件。
 * **integration lane では無効化する (#3071、空洞化防止)**: 誤った dependencies label が統合 PR に
 * 付いても template gate を必ず実行する。feature / hotfix lane は現行どおり skip (Dependabot exempt 二重防御)。
 * @param {string[]} labels
 * @param {Lane} [lane]
 * @returns {boolean}
 */
function hasDependenciesLabel(labels, lane) {
	if (lane === 'integration') return false;
	return labels.some((l) => l.includes('dependencies'));
}

/**
 * lane==='dependabot' の共通 skip。現行の actor 判定 skip を lane に吸収 (#2944 AC5)。
 * @param {Lane} lane
 * @returns {CheckResult | null}
 */
function dependabotSkip(lane) {
	if (lane === 'dependabot') {
		return { ok: true, skipped: true, message: 'dependabot lane のためスキップ (挙動不変)', lane };
	}
	return null;
}

/**
 * template から `^## ` 見出しを抽出 (check-pr-template-sections-sync の extractTemplateSections と一致)。
 * @param {string} template
 * @returns {string[]}
 */
export function extractTemplateSections(template) {
	return template
		.split('\n')
		.filter((line) => /^## (?!#)/.test(line))
		.map((line) => line.trimEnd());
}

/**
 * Check 1: 必須セクション存在確認 (lane-aware)。
 * - feature/hotfix: 現行どおり SSOT JSON (なければ template) の全 `## ` 見出しを必須。
 * - integration: INTEGRATION_REQUIRED_SECTIONS (現行の部分集合 + エビデンス表) を必須。
 * - dependabot: skip。
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkSectionPresence({ body, labels, template, ssotSections, lane }) {
	const dep = dependabotSkip(lane);
	if (dep) return dep;
	if (hasDependenciesLabel(labels, lane)) {
		return { ok: true, skipped: true, message: '依存関係更新 PR のためスキップ', lane };
	}

	let sections;
	let sourceLabel;
	if (lane === 'integration') {
		sections = INTEGRATION_REQUIRED_SECTIONS;
		sourceLabel = 'INTEGRATION_REQUIRED_SECTIONS (暫定 section set、#2944 / Phase B 接続点)';
	} else if (Array.isArray(ssotSections) && ssotSections.length > 0) {
		sections = ssotSections;
		sourceLabel = 'PR_TEMPLATE_SECTIONS.json (SSOT)';
	} else {
		sections = extractTemplateSections(template);
		sourceLabel = 'PULL_REQUEST_TEMPLATE.md (fallback)';
	}

	const missing = sections.filter((s) => !body.includes(s));
	if (missing.length > 0) {
		return {
			ok: false,
			lane,
			message:
				`❌ PR テンプレートの必須セクションが ${missing.length} 件削除されています。\n\n` +
				`lane: ${lane} / 参照 SSOT: ${sourceLabel}\n\n` +
				`削除されたセクション:\n${missing.map((s) => `  • ${s}`).join('\n')}\n\n` +
				'PR テンプレートのセクション見出し (## ...) を削除しないでください。\n' +
				'内容が該当しない場合は「N/A」または「該当なし」と記載してください。',
		};
	}
	return {
		ok: true,
		lane,
		message: `✅ [${lane}] 必須セクション ${sections.length} 件 — 全て存在 (source: ${sourceLabel})`,
	};
}

/**
 * template から 'closes #' を含むセクション見出しを動的取得。
 * @param {string} template
 * @returns {string}
 */
export function detectIssueSectionHeading(template) {
	const lines = template.split('\n');
	let heading = '## 関連 Issue';
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (/^## /.test(line)) {
			const sectionEndIdx = lines.findIndex((l, idx) => idx > i && /^## /.test(l));
			const lookaheadEnd = sectionEndIdx === -1 ? Math.min(i + 15, lines.length) : sectionEndIdx;
			const lookahead = lines.slice(i + 1, lookaheadEnd);
			if (lookahead.some((l) => /closes\s+#/.test(l))) {
				heading = line.trim();
				break;
			}
		}
	}
	return heading;
}

/**
 * body から指定見出しのセクション本文を切り出す。
 * @param {string} body
 * @param {string} heading
 * @returns {string}
 */
function sliceSection(body, heading) {
	const start = body.indexOf(heading);
	if (start === -1) return body;
	const end = body.indexOf('\n## ', start + 1);
	return body.slice(start, end > start ? end : start + 500);
}

/**
 * Check 2: 関連 Issue 番号の記入 (lane-aware)。
 * - feature/hotfix: 現行どおり `closes #<番号>` 未入力検出 + `#\d+` 参照 or 理由 ≥10 文字。
 * - integration: `closes #<単一>` を必須にせず、含有 PR 一覧 (`#NNNN` 複数行 = 2 件以上) の存在を検証 (#2944 AC3)。
 * - dependabot: skip。
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkIssueReference({ body, labels, template, lane }) {
	const dep = dependabotSkip(lane);
	if (dep) return dep;
	if (hasDependenciesLabel(labels, lane)) {
		return { ok: true, skipped: true, message: '依存関係更新 PR のためスキップ', lane };
	}

	const heading = detectIssueSectionHeading(template);
	const section = sliceSection(body, heading);

	if (lane === 'integration') {
		// 統合 PR は Issue ではなく PR を束ねる。含有 PR 一覧 (#NNNN を 2 件以上) の存在を要求する。
		// 単一 `closes #` 偽装を不要にし、束ねた PR 群の列挙を正しい観点として検証する。
		const refs = section.match(/#\d+/g) || [];
		const uniqueRefs = [...new Set(refs)];
		if (uniqueRefs.length >= 2) {
			return {
				ok: true,
				lane,
				message: `✅ [integration] 含有 PR 一覧: ${uniqueRefs.join(', ')} (${uniqueRefs.length} 件)`,
			};
		}
		return {
			ok: false,
			lane,
			message:
				`❌ [integration] 「${heading}」に含有 PR 一覧がありません (統合 PR は複数 PR を束ねます)。\n\n` +
				'束ねた PR を `#NNNN` 形式で 2 件以上列挙してください。\n' +
				'統合 PR は単一 Issue に紐づかないため `closes #<単一番号>` は不要です。\n' +
				'例:\n```\n## 関連 Issue\n本統合 PR が含む PR:\n- #3010\n- #3012\n- #3015\n```',
		};
	}

	// feature / hotfix: 現行ロジック完全維持 (#2944 AC4 回帰ゼロ)
	if (/^closes\s+#\s*$/im.test(body) || /closes\s+#\s*<!--/im.test(body)) {
		return {
			ok: false,
			lane,
			message:
				`❌ 「${heading}」セクションの \`closes #\` に Issue 番号が記入されていません。\n\n` +
				'`closes #123` の形式で Issue 番号を記載してください。\n\n' +
				'関連する Issue がない場合は `closes` 行を削除し代わりに理由を明記してください。',
		};
	}

	const refs = section.match(/#\d+/g);
	if (refs && refs.length > 0) {
		return { ok: true, lane, message: `✅ 関連 Issue: ${refs.join(', ')}` };
	}

	const meaningfulLines = section
		.split('\n')
		.filter((l) => !l.startsWith(heading))
		.filter((l) => !/^closes\s+#\s*$/.test(l.trim()))
		.filter((l) => !/^\s*<!--/.test(l))
		.filter((l) => !/^\s*--!?>\s*$/.test(l))
		.filter((l) => l.trim().length > 0);
	const meaningfulText = meaningfulLines.join('').replace(/\s/g, '');
	if (meaningfulText.length >= 10) {
		return { ok: true, lane, message: '✅ 関連 Issue: Issue 番号なし（理由の記述あり）' };
	}

	return {
		ok: false,
		lane,
		message:
			`❌ 「${heading}」セクションに Issue 番号の参照がありません。\n\n` +
			'`closes #123` の形式で関連する Issue 番号を記載してください。\n' +
			'Issue が存在しない場合は `closes` 行を削除し理由を明記してください。',
	};
}

/**
 * template から複数の `- [ ]` を持つ変更タイプセクション見出しを動的取得。
 * @param {string} template
 * @returns {string}
 */
export function detectChangeTypeHeading(template) {
	const lines = template.split('\n');
	let heading = '## 変更タイプ';
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (/^## /.test(line)) {
			const sectionEndIdx = lines.findIndex((l, idx) => idx > i && /^## /.test(l));
			const lookaheadEnd = sectionEndIdx === -1 ? Math.min(i + 50, lines.length) : sectionEndIdx;
			const lookahead = lines.slice(i + 1, lookaheadEnd);
			if (lookahead.filter((l) => /^- \[ \]/.test(l)).length >= 3) {
				heading = line.trim();
				break;
			}
		}
	}
	return heading;
}

/**
 * Check 3: 変更タイプの選択 (lane-aware)。
 * - feature/hotfix: 1 つ以上 [x] (現行どおり)。
 * - integration: 複数タイプ混在を許容 (統合 PR は feat/fix/docs 混在が正常)。1 つ以上 [x] は維持 (#2944)。
 *   → 閾値は feature と同じ (1 つ以上) だが、複数選択を violation 扱いしない点が明示的に異なる
 *     (現行ロジックも複数選択を fail にはしないため、integration では「混在 OK」を message で明示する)。
 * - dependabot: skip。
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkChangeType({ body, labels, template, lane }) {
	const dep = dependabotSkip(lane);
	if (dep) return dep;
	if (hasDependenciesLabel(labels, lane)) {
		return { ok: true, skipped: true, message: '依存関係更新 PR のためスキップ', lane };
	}

	const heading = detectChangeTypeHeading(template);
	const start = body.indexOf(heading);
	if (start === -1) {
		// 現行は warning + return (section-presence に委譲)。ここでも ok 扱い (skip)。
		return {
			ok: true,
			skipped: true,
			lane,
			message: `「${heading}」セクションが見つかりません (section-presence チェックに委譲)`,
		};
	}
	const end = body.indexOf('\n## ', start + 1);
	const section = body.slice(start, end > start ? end : start + 600);
	const checked = section.match(/- \[[xX]\]/g);

	if (!checked || checked.length === 0) {
		return {
			ok: false,
			lane,
			message:
				`❌ 「${heading}」で何も選択されていません。\n\n` +
				'該当する変更タイプのチェックボックスを選択してください。\n\n例:\n```\n- [x] feat: 新機能\n```',
		};
	}

	const items = (section.match(/- \[[xX]\] (.+)/g) || []).map((i) => i.replace(/- \[[xX]\] /, ''));
	if (lane === 'integration') {
		return {
			ok: true,
			lane,
			message: `✅ [integration] 変更タイプ (複数混在 OK): ${items.join(' / ')}`,
		};
	}
	return { ok: true, lane, message: `✅ 変更タイプ: ${items.join(' / ')}` };
}

/**
 * Check 4: 顧客価値・目的の記入 (lane-aware)。
 * - feature/hotfix: 現行どおり 1 番目 ## section の **field**: placeholder 残存検出。
 * - integration: per-PR 顧客価値でなく「placeholder 残存検出のみ維持」(#2944)。
 *   → 統合 PR では field 構成が Phase B template で確定するため、現行 template の field に対し
 *     placeholder 残存のみを検出する (= feature と同一ロジックだが「リリースバッチ顧客価値サマリ」
 *     の意味付け。本 phase では検出ロジックは共通)。
 * - dependabot: skip。
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkCustomerValue({ body, labels, template, lane }) {
	const dep = dependabotSkip(lane);
	if (dep) return dep;
	if (hasDependenciesLabel(labels, lane)) {
		return { ok: true, skipped: true, message: '依存関係更新 PR のためスキップ', lane };
	}

	const lines = template.split('\n');
	const secondSectionIdx = lines.findIndex((l, i) => i > 0 && /^## /.test(l));
	const firstSectionLines = lines.slice(0, secondSectionIdx > 0 ? secondSectionIdx : 25);

	/** @type {string[]} */
	const inlineFields = [];
	/** @type {string[]} */
	const multilineFields = [];
	for (const l of firstSectionLines) {
		const inlineM = l.match(/^\*\*([^*]+)\*\*:\s*<!--/);
		if (inlineM?.[1]) inlineFields.push(inlineM[1]);
		const multiM = l.match(/^\*\*([^*]+)\*\*:\s*$/);
		if (multiM?.[1]) multilineFields.push(multiM[1]);
	}

	const errors = [];
	for (const field of inlineFields) {
		const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const m = body.match(new RegExp(`\\*\\*${escaped}\\*\\*:\\s*(.*)`));
		if (m) {
			const val = (m[1] ?? '').trim();
			// js/bad-tag-filter (CodeQL): 改行を含むコメント + `--!>` 終端も検出する
			if (!val || /^<!--[\s\S]*--!?>$/.test(val)) {
				errors.push(`\`**${field}**\` がプレースホルダーのまま未記入です。`);
			}
		}
	}
	for (const field of multilineFields) {
		const idx = body.indexOf(`**${field}**:`);
		if (idx !== -1) {
			const segment = body
				.slice(idx, idx + 400)
				.split('\n')
				.slice(1, 8);
			const hasContent = segment.some((l) => {
				const t = l.trim();
				return (
					t.length > 0 &&
					!t.startsWith('<!--') &&
					!t.startsWith('-->') &&
					!t.startsWith('**') &&
					!/^##/.test(t)
				);
			});
			if (!hasContent) {
				errors.push(`\`**${field}**\` の内容がプレースホルダーのまま未記入です。`);
			}
		}
	}

	if (errors.length > 0) {
		const prefix = lane === 'integration' ? '[integration] ' : '';
		return {
			ok: false,
			lane,
			message:
				`❌ ${prefix}「顧客価値・目的」セクションの必須項目が未記入です。\n\n` +
				`${errors.map((e, i) => `${i + 1}. ${e}`).join('\n\n')}\n\n` +
				'「何を変更したか」ではなく「なぜこの変更がユーザーにとって必要か」を記載してください。',
		};
	}
	const tag =
		lane === 'integration' ? '[integration] リリースバッチ顧客価値サマリ' : '顧客価値・目的';
	return {
		ok: true,
		lane,
		message: `✅ ${tag}: ${inlineFields.length + multilineFields.length} フィールド — 記入確認`,
	};
}

/**
 * template からテスト結果テーブルを含むセクション名を動的取得。
 * @param {string} template
 * @returns {string}
 */
export function detectTestSectionKeyword(template) {
	const lines = template.split('\n');
	let keyword = 'テスト実行結果';
	const tableHeaderIdx = lines.findIndex((l) => /テスト種別.*コマンド.*結果/.test(l));
	if (tableHeaderIdx !== -1) {
		for (let i = tableHeaderIdx; i >= 0; i -= 1) {
			const line = lines[i] ?? '';
			if (/^###?\s/.test(line)) {
				keyword = line.replace(/^###?\s+/, '').trim();
				break;
			}
		}
	}
	return keyword;
}

/**
 * Check 5: テスト実行結果の記入 (lane-aware)。
 * - feature/hotfix: 現行どおり結果列の placeholder / 空欄検出 (type:docs は skip)。
 * - integration: per-PR コマンド結果でなく「統合エビデンス表 (マージ判定エビデンス) の存在」を検証 (#2944)。
 *   → audit-team.md §3.5 のマージ判定エビデンス表。統合 PR では per-PR コマンド表ではなく
 *     最重厚レーンの集約結果表の存在を要求する。本 phase では「テスト結果テーブルが 1 行以上存在し、
 *     その結果列が placeholder/空でない」= エビデンス表が記入されていることを検証する
 *     (feature と同じ table 検証だが、表の意味付けが「集約エビデンス」)。
 * - dependabot / type:docs: skip。
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkTestResults({ body, labels, template, lane }) {
	const dep = dependabotSkip(lane);
	if (dep) return dep;
	if (hasDependenciesLabel(labels, lane)) {
		return { ok: true, skipped: true, message: '依存関係更新 PR のためスキップ', lane };
	}
	// integration lane では type:docs による skip を無効化する (#3071、空洞化防止)。
	if (lane !== 'integration' && labels.includes('type:docs')) {
		return { ok: true, skipped: true, message: 'type:docs PR のためスキップ', lane };
	}

	const keyword = detectTestSectionKeyword(template);
	const sectionIdx = body.indexOf(keyword);
	if (sectionIdx === -1) {
		return {
			ok: true,
			skipped: true,
			lane,
			message: `「${keyword}」セクションが見つかりません (section-presence チェックに委譲)`,
		};
	}

	const afterSection = body.slice(sectionIdx + keyword.length + 1);
	const nextSectionMatch = afterSection.search(/\n##\s/);
	const sectionEnd =
		nextSectionMatch !== -1
			? sectionIdx + keyword.length + 1 + nextSectionMatch
			: sectionIdx + 2000;
	const section = body.slice(sectionIdx, sectionEnd);

	const tableRows = section
		.split('\n')
		.filter((l) => /^\|[^|]+\|[^|]+\|[^|]+\|/.test(l))
		.filter((l) => !/^\|\s*[-:]+\s*\|/.test(l))
		.filter((l) => !/テスト種別\s*\|/.test(l));

	if (tableRows.length === 0) {
		if (lane === 'integration') {
			// 統合 PR ではエビデンス表 (1 行以上) の存在を必須とする (空洞化禁止)。
			return {
				ok: false,
				lane,
				message:
					`❌ [integration] 「${keyword}」に統合エビデンス表 (マージ判定エビデンス) がありません。\n\n` +
					'統合 PR は per-PR コマンド結果ではなく、最重厚レーンの集約結果 / マージ判定エビデンス表\n' +
					'(audit-team.md §3.5) を 1 行以上記載してください。\n例:\n' +
					'| 検証観点 | 集約結果 | エビデンス |\n' +
					'| 重量レーン E2E | PASS (含有 5 PR 分) | run #12345 |',
			};
		}
		return {
			ok: true,
			skipped: true,
			lane,
			message: 'テスト実行結果テーブルの行が見つかりません (docs / infra のみの変更の可能性)',
		};
	}

	const placeholderPattern = /<!--[^>]*?(?:PASS|FAIL|例:)[^>]*?-->/i;
	const placeholderRows = tableRows.filter((r) => placeholderPattern.test(r));
	const emptyResultRows = tableRows.filter((row) => {
		const cells = row
			.split('|')
			.slice(1, -1)
			.map((c) => c.trim());
		return cells.length >= 3 && cells[2] === '';
	});
	const violations = [...new Set([...placeholderRows, ...emptyResultRows])];

	if (violations.length > 0) {
		const examples = violations
			.slice(0, 3)
			.map((r) => `  ${r.slice(0, 100)}`)
			.join('\n');
		const prefix = lane === 'integration' ? '[integration] 統合エビデンス表 ' : '';
		return {
			ok: false,
			lane,
			message:
				`❌ ${prefix}「${keyword}」テーブルに ${violations.length} 件の未記入行があります。\n\n` +
				'各行の「結果」列に結果を記入してください (PASS / FAIL / 実行件数 等)。\n\n' +
				`未記入行（最大 3 件）:\n${examples}`,
		};
	}
	const tag = lane === 'integration' ? '[integration] 統合エビデンス表' : 'テスト実行結果';
	return { ok: true, lane, message: `✅ ${tag}: ${tableRows.length} 行すべて記入済み` };
}

/** check 名 → 関数の dispatch table (CLI 用)。 */
export const CHECKS = {
	'section-presence': checkSectionPresence,
	'issue-reference': checkIssueReference,
	'change-type': checkChangeType,
	'customer-value': checkCustomerValue,
	'test-results': checkTestResults,
};

/**
 * 簡易 argv パーサ (--check / --lane / --body-file / --labels-json / --template-file / --ssot-file)。
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
export function parseArgs(argv) {
	/** @type {Record<string, string>} */
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
	const checkName = args.check ?? '';
	const lane = /** @type {Lane} */ (args.lane || 'feature');
	const fn = /** @type {Record<string, (input: CheckInput) => CheckResult>} */ (CHECKS)[checkName];
	if (!fn) {
		console.error(
			`[pr-template-gate-checks] 未知の --check '${checkName}'。` +
				`有効値: ${Object.keys(CHECKS).join(' / ')}`,
		);
		process.exit(2);
	}
	if (!['feature', 'integration', 'hotfix', 'dependabot'].includes(lane)) {
		console.error(`[pr-template-gate-checks] 未知の --lane '${lane}'。`);
		process.exit(2);
	}

	/** @param {string} key @returns {string} */
	const readFileArg = (key) => {
		const path = args[key];
		if (!path) return '';
		if (!existsSync(path)) {
			console.error(`[pr-template-gate-checks] --${key} のファイルが見つかりません: ${path}`);
			process.exit(2);
		}
		return readFileSync(path, 'utf-8');
	};

	const body = readFileArg('body-file');
	const template = readFileArg('template-file');
	const labelsRaw = readFileArg('labels-json');
	const ssotRaw =
		args['ssot-file'] && existsSync(args['ssot-file']) ? readFileArg('ssot-file') : '';

	/** @type {string[]} */
	let labels = [];
	try {
		const parsed = labelsRaw ? JSON.parse(labelsRaw) : [];
		labels = Array.isArray(parsed)
			? parsed
					.map((/** @type {unknown} */ l) =>
						typeof l === 'string'
							? l
							: l && typeof l === 'object' && 'name' in l
								? String(/** @type {{ name: unknown }} */ (l).name)
								: '',
					)
					.filter(Boolean)
			: [];
	} catch (err) {
		console.error(
			`[pr-template-gate-checks] labels-json parse 失敗: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(2);
	}

	/** @type {string[] | null} */
	let ssotSections = null;
	if (ssotRaw) {
		try {
			const ssot = JSON.parse(ssotRaw);
			if (Array.isArray(ssot.sections)) ssotSections = ssot.sections.map(String);
		} catch (err) {
			console.error(
				`[pr-template-gate-checks] ssot-file parse 失敗 (template fallback): ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	const result = fn({ body, labels, template, ssotSections, lane });
	console.log(result.message);
	process.exit(result.ok ? 0 : 1);
}
