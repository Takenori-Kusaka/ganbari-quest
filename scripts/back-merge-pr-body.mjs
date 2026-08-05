#!/usr/bin/env node
/**
 * scripts/back-merge-pr-body.mjs — Issue #3879
 *
 * hotfix back-merge PR (main → develop、`.github/workflows/hotfix-back-merge.yml` #2951) の
 * PR body を **PR template gate 準拠形式**で生成する純粋関数 SSOT + 自己検証 CLI。
 *
 * ## 背景 (#3879 / 実例 #3876)
 *
 * 旧 workflow は back-merge 説明のみの最小 body を inline 生成しており、PR template の
 * 必須 11 セクション (`.github/PR_TEMPLATE_SECTIONS.json` SSOT) と AC 検証マップ 4 列を欠くため、
 * CI 必須 gate 2 件 (`Verify AC map in PR body` / `必須セクションの存在確認`) が hard-fail
 * → hotfix のたびに QM が手作業で compliant body を補完していた。本 script は自動発行 body を
 * **生成時点で gate 準拠**にし、QM 手作業 remediation を構造的に廃す。
 *
 * ## 責務分担 (integration-pr-body.mjs / hotfix-back-merge.mjs と同型)
 *
 *   - 本 file = back-merge PR **本文の組み立て** (renderBackMergePrBody、副作用なし) +
 *     **生成時自己検証** (validateBackMergePrBody — 既存 gate SSOT の検証関数を import して
 *     生成 body に適用。検証 fail なら CLI が exit 1 = workflow を落とす。silent 不備を出さない、
 *     ADR-0006 整合)。
 *   - workflow (.github/workflows/hotfix-back-merge.yml) = back-merge 判定 / branch 操作 /
 *     PR upsert / label 付与 (挙動不変。本 script は body 生成のみ差し替える)。
 *
 * ## 自己検証で適用する gate ロジック (再実装せず既存 SSOT を import、#1442)
 *
 *   - scripts/check-pr-body.mjs — 必須セクション / 禁止語 / AC マップ 4 列 / Ready checklist /
 *     mojibake / self-review 証跡 (pre-ready Step 9 と同一)
 *   - scripts/check-ac-verification-map.mjs — CI required context `Verify AC map in PR body`
 *     (back-merge PR は base=develop → lane=feature、pr-lane.mjs rule 4)
 *   - scripts/pr-template-gate-checks.mjs — pr-template-gate.yml 6 job (必須セクション存在 /
 *     関連 Issue / 変更タイプ / 顧客価値 / テスト実行結果 / closing keyword)
 *   - scripts/check-merge-gate-checklist.mjs — CI required context `PR チェックリスト完了確認`
 *
 * Usage (workflow の Upsert step から呼ぶ):
 *   node scripts/back-merge-pr-body.mjs --hotfix-pr 3872 --hotfix-head fix/3870-x \
 *     --merge-sha 318e43a5... --branch back-merge/3872 [--conflict]
 *   → stdout に PR body 全文 (検証ログは stderr)
 *
 * exit: 0 = 生成 + 自己検証 PASS / 1 = 自己検証 FAIL (gate 違反 body を発行させない) / 2 = 引数不足
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAcVerification } from './check-ac-verification-map.mjs';
import { checkMergeGateChecklist } from './check-merge-gate-checklist.mjs';
import {
	checkAcMap,
	checkEnvDistributionForHotfix,
	checkSelfReviewEvidence,
	detectMojibake,
	extractRequiredSections,
	findMissingSections,
	findUncheckedReadyChecklist,
	scanForbiddenTerms,
} from './check-pr-body.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';
import { CHECKS as TEMPLATE_GATE_CHECKS } from './pr-template-gate-checks.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** PR template (必須セクション見出しの SSOT 源泉、check-pr-body.mjs と同一参照)。 */
export const TEMPLATE_PATH = join(repoRoot, '.github', 'PULL_REQUEST_TEMPLATE.md');
/** 必須セクション SSOT JSON (#2060、pr-template-gate.yml section-presence が参照)。 */
export const SECTIONS_SSOT_PATH = join(repoRoot, '.github', 'PR_TEMPLATE_SECTIONS.json');

/**
 * back-merge PR に付与される label (workflow step 5 が付与、drift contract SSOT #2951 AC6)。
 * closing-keyword gate の back-merge skip / lane 判定と整合させるため検証時にも渡す。
 * @type {readonly string[]}
 */
export const BACK_MERGE_LABELS = Object.freeze(['back-merge']);

/**
 * @typedef {object} BackMergeBodyInput
 * @property {string|number} hotfixPr 元 hotfix PR 番号
 * @property {string} hotfixHead 元 hotfix の head branch 名 (例: 'fix/3870-x')
 * @property {string} mergeSha main の merge commit SHA
 * @property {string} branch back-merge branch 名 (例: 'back-merge/3872')
 * @property {boolean} [isConflict] conflict marker を残した PR か (#2951 AC3)
 */

/**
 * conflict 時の手動解決手順 (旧 workflow inline body から移設、内容同一)。
 * @param {string} branch
 * @returns {string}
 */
function conflictInstructions(branch) {
	return [
		'⚠️ **CONFLICT — 手動解決が必要**',
		'',
		'自動 merge で conflict が発生したため、conflict marker を残したまま branch を作成しました。',
		'**自動 force resolve は行っていません** (#2951 no-go)。`status:blocked` label が付与されています。',
		'',
		'解決手順:',
		`1. \`git fetch origin && git switch ${branch}\``,
		'2. conflict を手動解決して commit',
		'3. `git push` 後、本 PR の `status:blocked` を外して develop 軽量レーン gate を通す',
	].join('\n');
}

/**
 * back-merge PR body 全文を生成する純粋関数 (#3879 AC1)。
 *
 * PR template の必須 11 セクション (`## ` 見出し完全一致) + AC 検証マップ 4 列を備え、
 * feature lane (base=develop) の全 body gate — 必須セクション存在 / AC マップ / 禁止語 /
 * Ready checklist / closing keyword (back-merge label skip) — を生成時点で満たす。
 *
 * back-merge は既 QM 承認済 hotfix の機械同期で独自 AC を持たないため、AC マップは
 * 「hotfix #N で検証済の変更を develop に取り込み silent-revert を防ぐ」観点 + 元 hotfix PR
 * 参照で埋める (Issue #3879 提案 2)。
 *
 * @param {BackMergeBodyInput} input
 * @returns {string} PR body markdown 全文
 */
export function renderBackMergePrBody({ hotfixPr, hotfixHead, mergeSha, branch, isConflict }) {
	const pr = String(hotfixPr);
	const sha7 = String(mergeSha ?? '').slice(0, 7);
	const conflict = isConflict === true;

	const acRows = conflict
		? [
				`| AC1 | hotfix #${pr} の変更を conflict marker 付き branch として可視化し、手動解決へ誘導する (自動 force resolve なし、#2951 no-go) | workflow step「Create back-merge branch」の \`git merge\` 結果 | conflict 検知 → marker を残して commit + \`status:blocked\` label 付与 (silent fail なし、#2951 AC3) |`,
				`| AC2 | 手動解決後、develop 軽量レーン gate (branch-strategy.md §4) を通過して merge される | 本 PR の required status checks (機械強制) | 解決手順は「レビュー依頼事項・破壊的変更」セクション記載。merge 判断は QM/lab 責務 (ADR-0022) |`,
			]
		: [
				`| AC1 | hotfix #${pr} で QM 検証済の変更が develop に取り込まれ、次回統合 (develop→main) での silent-revert を防ぐ (branch-strategy.md §5) | \`git merge-base --is-ancestor ${sha7} ${branch}\` | merge commit \`${sha7}\` を \`${branch}\` に clean merge 済 (workflow step「Create back-merge branch」で conflict なし) |`,
				`| AC2 | develop 軽量レーン gate (branch-strategy.md §4) を通過して merge される | 本 PR の required status checks (機械強制) | gate 通過は GitHub required checks が保証。merge 判断は QM/lab 責務 (ADR-0022) |`,
			];

	const reviewNote = conflict
		? conflictInstructions(branch)
		: [
				'conflict なく develop に取り込めました。develop 軽量レーン gate (branch-strategy.md §4) を',
				'通過後に merge してください (merge は QM/lab 責務、ADR-0022 / feedback_no_autonomous_qa_merge)。',
			].join('\n');

	return [
		'## 顧客価値・目的',
		'',
		'**対象ユーザー**: 開発チーム / 運営 (システム全体 — main / develop の drift 防止)',
		'',
		`**解決する課題**: main に merge 済の hotfix #${pr} (\`${hotfixHead}\`, ${sha7}) が develop に未取込のままだと、次回の develop→main 統合で hotfix が silent-revert される (branch-strategy.md §5「back-merge 必須」)。`,
		'',
		`**期待される効果**: hotfix #${pr} の変更が develop にも反映され、main / develop の分岐が解消される。`,
		'',
		'## 関連 Issue',
		'',
		`hotfix #${pr} (元 PR) の main→develop back-merge (機械同期、#2951 / branch-strategy.md §5)。`,
		'本 PR 自体が close する Issue はない (close は元 hotfix PR 側で完結済)。',
		'',
		'<!-- no-issue-close: back-merge は既 merge 済 hotfix の機械同期であり、独自の close 対象 Issue を持たない (#3879) -->',
		'',
		'## AC 検証マップ (ADR-0004)',
		'',
		'| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |',
		'|---------|--------|---------|------------------|',
		...acRows,
		'',
		'## 変更タイプ',
		'',
		`- [x] fix: バグ修正 (hotfix #${pr} の main→develop 機械同期)`,
		'',
		'## 影響範囲・横展開チェック',
		'',
		`**影響を受ける画面・機能**: hotfix #${pr} と同一 (元 PR の同名セクション参照)。本 PR は git merge による同期のみで新規変更を含まない。`,
		'',
		`- [x] N/A — 並行実装の影響範囲外 (hotfix #${pr} の develop 同期のみ。横展開判断・設計書同期・LP 整合はいずれも元 PR 側で完了済)`,
		'',
		'## テスト・品質セルフチェック',
		'',
		'| テスト種別 | コマンド | 結果 |',
		'|---|---|---|',
		`| hotfix #${pr} 側 gate | main merge 前の QM Approve + CI 全 gate (ADR-0022) | PASS (元 PR で検証済) |`,
		'| body 自己検証 | `node scripts/back-merge-pr-body.mjs` | PASS (check-pr-body / AC map / template-gate / merge-gate、#3879) |',
		'',
		'- [x] 本 PR は同一変更の機械同期のため、追加・変更したテストは「N/A」',
		`- [x] \`git merge\` による機械同期で新規コードを含まない (SOLID / DRY / Security / A11y / Performance の検証は hotfix #${pr} 側で完了済)`,
		'- [x] 新規 env / secret の追加なし (ADR-0006): 「N/A」',
		'',
		'## スクリーンショット / ビジュアルデモ',
		'',
		`**該当なし** (hotfix #${pr} で QM 検証済の変更の機械同期であり、本 PR 固有の新規 UI 変更はない。UI 変更の SS 証跡は元 hotfix PR 側に添付済)。`,
		'',
		'## レビュー依頼事項・破壊的変更',
		'',
		'**破壊的変更**:',
		`- [x] このPRに破壊的変更は**含まれない** (hotfix #${pr} の同期のみ)`,
		'',
		'**レビュー依頼事項・QM**:',
		'',
		reviewNote,
		'',
		'## 配布済み env / secret (ADR-0006)',
		'',
		'- [x] N/A — 新規 env / secret の追加なし (機械同期のため)',
		'',
		'## Ready for Review チェックリスト',
		'',
		'- [x] back-merge branch が origin/develop 起点で作成されている (workflow step「Create back-merge branch」)',
		`- [x] merge SHA \`${sha7}\` が develop 未取込であることを no-op guard (\`git merge-base --is-ancestor\`、#2951 AC5) で確認済`,
		'- [x] 本 body は必須 11 セクション + AC 検証マップ 4 列を生成時に自己検証済 (`node scripts/back-merge-pr-body.mjs`、#3879)',
		'- [x] drift contract label `back-merge` を付与済 (B-3 統合 PR §6 が未取込 hotfix として読む、#2951 AC6)',
		conflict
			? '- [x] conflict marker を残した branch を作成し `status:blocked` を付与した (自動 force resolve なし、#2951 AC3)'
			: '- [x] clean merge を確認済 (conflict なし)',
		'',
		'## QM レビュー結果',
		'',
		'<!-- QM が記入。フォーマット・必須手順は docs/sessions/qm-session.md「Tier 2 手順 5」を参照。 -->',
		'',
		'---',
		'',
		'- base: `develop` (軽量レーン、`pr-lane.mjs` rule 4 = feature)',
		'- author: GitHub App ボット名義 (ADR-0022 Amendment 5、承認は人間/lab)',
		`- 元 hotfix: #${pr} (\`${hotfixHead}\`, merge commit \`${sha7}\`)`,
		'- 本 body は `.github/workflows/hotfix-back-merge.yml` が `scripts/back-merge-pr-body.mjs` で自動生成 + 自己検証 (#2951 / #3879)',
	].join('\n');
}

/**
 * @typedef {object} BodyViolation
 * @property {string} gate 由来 gate (検証ロジックの SSOT script 名)
 * @property {string} message 違反内容
 */

/**
 * 生成 body を既存 gate SSOT の検証ロジックに通す (#3879 AC — 生成→検証→fail で silent 不備を出さない)。
 *
 * 検証は CI required gate と同一の関数を import して適用する (再実装なし、#1442)。
 * back-merge PR の実 lane (base=develop → 'feature'、pr-lane.mjs rule 4) と実 label
 * (BACK_MERGE_LABELS) で評価するため、CI 上の判定と常に一致する。
 *
 * @param {string} body 生成した PR body
 * @param {{ template?: string; ssotSections?: string[] | null; labels?: string[] }} [options]
 *   省略時は repo 内の SSOT file (`TEMPLATE_PATH` / `SECTIONS_SSOT_PATH`) を読む。
 * @returns {BodyViolation[]} 違反一覧 (空 = 全 gate PASS)
 */
export function validateBackMergePrBody(body, options = {}) {
	const template = options.template ?? readFileSync(TEMPLATE_PATH, 'utf-8');
	const ssotSections =
		options.ssotSections !== undefined
			? options.ssotSections
			: (JSON.parse(readFileSync(SECTIONS_SSOT_PATH, 'utf-8')).sections ?? null);
	const labels = options.labels ?? [...BACK_MERGE_LABELS];

	/** @type {BodyViolation[]} */
	const violations = [];

	// --- 1. check-pr-body.mjs (pre-ready Step 9 と同一ロジック) ---
	const missing = findMissingSections(body, extractRequiredSections(template));
	if (missing.length > 0) {
		violations.push({
			gate: 'check-pr-body/missing-required-sections',
			message: `必須セクション欠落: ${missing.join(' / ')}`,
		});
	}
	const forbidden = scanForbiddenTerms(body);
	if (forbidden.length > 0) {
		violations.push({
			gate: 'check-pr-body/forbidden-terms',
			message: forbidden
				.slice(0, 5)
				.map((v) => `L${v.lineNo} 「${v.term}」: ${v.line.slice(0, 60)}`)
				.join(' | '),
		});
	}
	const acMap = checkAcMap(body);
	if (acMap) violations.push({ gate: `check-pr-body/${acMap.id}`, message: acMap.message });
	const unchecked = findUncheckedReadyChecklist(body);
	if (unchecked.length > 0) {
		violations.push({
			gate: 'check-pr-body/unchecked-ready-checklist',
			message: unchecked
				.map((u) => `「${u.section}」未チェック ${u.uncheckedCount} 件`)
				.join(' / '),
		});
	}
	for (const m of detectMojibake(body)) {
		violations.push({ gate: `check-pr-body/${m.id}`, message: m.message.split('\n')[0] ?? m.id });
	}
	const selfReview = checkSelfReviewEvidence(body);
	if (selfReview) {
		violations.push({
			gate: `check-pr-body/${selfReview.id}`,
			message: selfReview.message.split('\n')[0] ?? selfReview.id,
		});
	}
	const envDist = checkEnvDistributionForHotfix(body, labels);
	if (envDist) violations.push({ gate: `check-pr-body/${envDist.id}`, message: envDist.message });

	// --- 2. CI required context `Verify AC map in PR body` (check-ac-verification-map.mjs) ---
	const acResult = checkAcVerification({ body, labels, lane: 'feature' });
	if (!acResult.ok) {
		violations.push({
			gate: 'check-ac-verification-map/feature',
			message: acResult.error ?? 'FAIL',
		});
	}

	// --- 3. pr-template-gate.yml 6 job (pr-template-gate-checks.mjs) ---
	for (const [name, fn] of Object.entries(TEMPLATE_GATE_CHECKS)) {
		const result = fn({
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature',
		});
		if (!result.ok) {
			violations.push({ gate: `pr-template-gate/${name}`, message: result.message });
		}
	}

	// --- 4. CI required context `PR チェックリスト完了確認` (check-merge-gate-checklist.mjs) ---
	const mergeGate = checkMergeGateChecklist({ body, labels, lane: 'feature' });
	if (!mergeGate.ok) {
		violations.push({
			gate: 'check-merge-gate-checklist/feature',
			message: mergeGate.error ?? 'FAIL',
		});
	}

	return violations;
}

/**
 * 簡易 argv パーサ (integration-pr-body.mjs と同型)。判定 logic は持たない。
 *
 * @param {string[]} argv process.argv.slice(2)
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv) {
	/** @type {Record<string, string | boolean>} */
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === undefined || !arg.startsWith('--')) continue;
		const eq = arg.indexOf('=');
		if (eq !== -1) {
			out[arg.slice(2, eq)] = arg.slice(eq + 1);
			continue;
		}
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) {
			out[arg.slice(2)] = true; // flag (--conflict)
		} else {
			out[arg.slice(2)] = next;
			i += 1;
		}
	}
	return out;
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const hotfixPr = String(args['hotfix-pr'] ?? '');
	const hotfixHead = String(args['hotfix-head'] ?? '');
	const mergeSha = String(args['merge-sha'] ?? '');
	const branch = String(args.branch ?? '');
	const isConflict = args.conflict === true || args.conflict === 'true';

	if (!hotfixPr || !mergeSha || !branch) {
		console.error(
			'[back-merge-pr-body] Usage: node scripts/back-merge-pr-body.mjs --hotfix-pr <num> --hotfix-head <branch> --merge-sha <sha> --branch <back-merge/branch> [--conflict]',
		);
		process.exit(2);
	}

	const body = renderBackMergePrBody({ hotfixPr, hotfixHead, mergeSha, branch, isConflict });
	const violations = validateBackMergePrBody(body);

	if (violations.length > 0) {
		console.error(
			`[back-merge-pr-body] 自己検証 FAIL — 生成 body が gate に違反 (${violations.length} 件)。` +
				'gate 違反 body を発行させないため exit 1 で workflow を落とします (#3879 / ADR-0006):',
		);
		for (const v of violations) {
			console.error(`  ✗ [${v.gate}] ${v.message.split('\n')[0]}`);
		}
		process.exit(1);
	}

	console.error('[back-merge-pr-body] 自己検証 PASS — 全 gate 準拠 (stderr log、body は stdout)');
	process.stdout.write(body);
	process.exit(0);
}
