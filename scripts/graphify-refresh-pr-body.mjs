#!/usr/bin/env node
/**
 * scripts/graphify-refresh-pr-body.mjs — Issue #4536
 *
 * graphify-out 定期再生成 PR (`.github/workflows/graphify-refresh.yml`) の PR body を
 * **PR template gate 準拠形式**で生成する純粋関数 SSOT + 自己検証 CLI。
 *
 * ## 背景 (#4536)
 *
 * `graphify-out/**` (graph.json 等) は git 追跡している (coldstart 解消、docs/CLAUDE.md §graphify)。
 * 以前は全 branch でコミットのたびに再生成していたため、並行する feature branch がそれぞれ
 * 独自の graphify-out を持ち、develop への merge のたびに残り全 PR が graphify-out だけで
 * conflict していた (実測: PR #4514 merge 時、conflict は graphify-out 3 file のみ)。
 *
 * 対策として `.husky/post-commit` は develop/main 以外での再生成を止め、develop 上の
 * 再生成は本 workflow が push 契機で行い、bot PR として発行する (直接 push は branch
 * ruleset の required review で拒否されるため、back-merge と同じ PR 経由フロー)。
 *
 * ## 責務分担 (back-merge-pr-body.mjs / integration-pr-body.mjs と同型)
 *
 *   - 本 file = graphify-refresh PR **本文の組み立て** (renderGraphifyRefreshPrBody、副作用なし) +
 *     **生成時自己検証** (validateGraphifyRefreshPrBody — 既存 gate SSOT の検証関数を import して
 *     生成 body に適用。検証 fail なら CLI が exit 1 = workflow を落とす。silent 不備を出さない、
 *     ADR-0006 整合)。
 *   - workflow (.github/workflows/graphify-refresh.yml) = 再生成 / 差分判定 / branch 操作 /
 *     PR upsert (本 script は body 生成のみ担当)。
 *
 * Usage (workflow の Upsert step から呼ぶ):
 *   node scripts/graphify-refresh-pr-body.mjs --branch chore/graphify-refresh --sha <develop HEAD sha>
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
	checkEnvDistributionForHotfix,
	checkSelfReviewEvidence,
	detectMojibake,
	extractRequiredSections,
	findMissingSections,
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
 * graphify-refresh PR に付与される label (workflow が付与、drift contract 不要のため 1 種のみ)。
 * @type {readonly string[]}
 */
export const GRAPHIFY_REFRESH_LABELS = Object.freeze(['type:infra']);

/**
 * @typedef {object} GraphifyRefreshBodyInput
 * @property {string} branch 再生成 branch 名 (例: 'chore/graphify-refresh')
 * @property {string} sha 再生成起点にした develop HEAD の SHA
 */

/**
 * graphify-refresh PR body 全文を生成する純粋関数。
 *
 * PR template の必須 7 セクション (`## ` 見出し完全一致) を備え、feature lane (base=develop) の
 * 全 body gate — 必須セクション存在 / AC マップ / 禁止語 / closing keyword — を生成時点で満たす。
 * 生成物のみの機械同期であり独自の close 対象 Issue を持たないため `<!-- no-issue-close -->` を使う。
 *
 * @param {GraphifyRefreshBodyInput} input
 * @returns {string} PR body markdown 全文
 */
export function renderGraphifyRefreshPrBody({ branch, sha }) {
	const sha7 = String(sha ?? '').slice(0, 7);

	const acRows = [
		'| AC1 | develop 上の graphify-out (graph.json 等) が develop HEAD のコード状態と一致する (coldstart 解消、docs/CLAUDE.md §graphify) | `graphify update .` の差分有無 | 差分がある場合のみ本 PR が発行される (差分 0 なら workflow は PR を発行しない) |',
		'| AC2 | develop 軽量レーン gate (branch-strategy.md §4) を通過して merge される | 本 PR の required status checks (機械強制) | gate 通過は GitHub required checks が保証。merge 判断は QM/lab 責務 (ADR-0022) |',
	];

	return [
		'## 顧客価値・目的',
		'',
		'**対象ユーザー**: 開発チーム (システム全体 — graphify ナレッジグラフを使う AI セッション全員)',
		'',
		'**解決する課題**: `graphify-out/**` は git 追跡しており、新しい clone / セッションがチェックアウト' +
			'直後から構造を引ける (コールドスタート解消、docs/CLAUDE.md §graphify)。feature branch では' +
			'再生成しなくなった (#4536) ため、develop 上の内容を最新に保つには本 PR のような定期反映が要る。',
		'',
		'**期待される効果**: develop の `graphify-out` が現在のコード状態と乖離しない。',
		'',
		'## 関連 Issue',
		'',
		'#4536 (feature branch 側の per-commit 再生成を止め、graphify-out 由来の並行 PR conflict を' +
			'構造的に解消する機構導入) の一部として稼働する定期再生成。本 PR 自体は新規 Issue を close しない。',
		'',
		'<!-- no-issue-close: graphify-out の機械再生成であり、独自の close 対象 Issue を持たない (#4536) -->',
		'',
		'## 変更内容',
		'',
		`develop HEAD (\`${sha7}\`) を対象に \`graphify update .\` を実行し、差分があった \`graphify-out/graph.json\` / \`graphify-out/manifest.json\` / \`graphify-out/GRAPH_REPORT.md\` / \`graphify-out/graph.html\` を反映します。`,
		'製品コード / テスト / 設計書の変更は含みません。',
		'',
		'## 検証',
		'',
		'`.github/workflows/graphify-refresh.yml` の `graphify-artifacts-parseable` 相当チェック' +
			' (`tests/unit/architecture/graphify-artifacts-parseable.test.ts`) が通常の CI required check' +
			' として本 PR にも適用されます。',
		'本 PR の body 生成時に自己検証 (`node scripts/graphify-refresh-pr-body.mjs`) を実行し、PASS しています。',
		'',
		'## 影響範囲',
		'',
		'**影響を受ける画面・機能**: なし (`graphify-out/**` のみ、アプリ挙動に影響しない生成物)。',
		'破壊的変更は含まれません。',
		'',
		'| AC | 検証観点 | 検証方法 | 結果 |',
		'|---|---|---|---|',
		...acRows,
		'',
		'## 配布済み env / secret (ADR-0006)',
		'',
		'- [x] N/A — 新規 env / secret の追加なし (機械生成のため)',
		'',
		'## QM レビュー結果',
		'',
		'<!-- QM が記入。フォーマット・必須手順は docs/sessions/qm-session.md「Tier 2 手順 5」を参照。 -->',
		'',
		'---',
		'',
		'- base: `develop` (軽量レーン、`pr-lane.mjs` rule 4 = feature)',
		'- author: GitHub App ボット名義 (ADR-0022 Amendment 5、承認は人間/lab)',
		`- 再生成 branch: \`${branch}\` (upsert、前回の未 merge PR があれば最新 develop 基点で作り直す)`,
		`- 再生成起点: develop HEAD \`${sha7}\``,
		'- 本 body は `.github/workflows/graphify-refresh.yml` が `scripts/graphify-refresh-pr-body.mjs` で自動生成 + 自己検証 (#4536)',
	].join('\n');
}

/**
 * @typedef {object} BodyViolation
 * @property {string} gate 由来 gate (検証ロジックの SSOT script 名)
 * @property {string} message 違反内容
 */

/**
 * 生成 body を既存 gate SSOT の検証ロジックに通す (back-merge-pr-body.mjs と同型)。
 *
 * @param {string} body 生成した PR body
 * @param {{ template?: string; ssotSections?: string[] | null; labels?: string[] }} [options]
 * @returns {BodyViolation[]} 違反一覧 (空 = 全 gate PASS)
 */
export function validateGraphifyRefreshPrBody(body, options = {}) {
	const template = options.template ?? readFileSync(TEMPLATE_PATH, 'utf-8');
	const ssotSections =
		options.ssotSections !== undefined
			? options.ssotSections
			: (JSON.parse(readFileSync(SECTIONS_SSOT_PATH, 'utf-8')).sections ?? null);
	const labels = options.labels ?? [...GRAPHIFY_REFRESH_LABELS];

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
 * 簡易 argv パーサ (back-merge-pr-body.mjs と同型)。判定 logic は持たない。
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
			out[arg.slice(2)] = true;
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
	const branch = String(args.branch ?? '');
	const sha = String(args.sha ?? '');

	if (!branch || !sha) {
		console.error(
			'[graphify-refresh-pr-body] Usage: node scripts/graphify-refresh-pr-body.mjs --branch <chore/graphify-refresh> --sha <develop HEAD sha>',
		);
		process.exit(2);
	}

	const body = renderGraphifyRefreshPrBody({ branch, sha });
	const violations = validateGraphifyRefreshPrBody(body);

	if (violations.length > 0) {
		console.error(
			`[graphify-refresh-pr-body] 自己検証 FAIL — 生成 body が gate に違反 (${violations.length} 件)。` +
				'gate 違反 body を発行させないため exit 1 で workflow を落とします (#4536 / ADR-0006):',
		);
		for (const v of violations) {
			console.error(`  ✗ [${v.gate}] ${v.message.split('\n')[0]}`);
		}
		process.exit(1);
	}

	console.error(
		'[graphify-refresh-pr-body] 自己検証 PASS — 全 gate 準拠 (stderr log、body は stdout)',
	);
	process.stdout.write(body);
	process.exit(0);
}
