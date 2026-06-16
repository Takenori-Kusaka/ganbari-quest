#!/usr/bin/env node
/**
 * scripts/check-internal-terms.mjs (#2288 EPIC #2283 ⑤)
 *
 * 親 UI への内部用語 (DynamoDB / Pre-PMF Bucket A / アクティベーションファネル等) 露出を
 * CI で自動検知する。AN-5 (#2180) 観察「内部用語 UI 露出 = 3 EPIC 連続発見
 * (admin-add-ux #2253 / rewards-cheer-shop #2266 / analytics-removal #2283)」の構造的解消。
 *
 * 検出対象:
 *   - インフラ・実装基盤: DynamoDB / SQLite / Cognito / Stripe / SES / CloudFront
 *   - 設計・運用語彙: Pre-PMF / Bucket A / Bucket B / Bucket C
 *   - SaaS マーケ語彙: アクティベーションファネル / リテンションコホート / Sean Ellis / チャーン / MRR
 *   - 開発内部名: テナント (UI では「家庭」)
 *
 * 対象ファイル: src/routes/(parent)/, src/lib/features/admin/ 配下の .svelte / .ts
 * 除外パス:
 *   - src/routes/ops/ (運用者向け、内部用語許容)
 *   - src/lib/server/, src/lib/analytics/ (サーバー実装、UI 露出なし)
 *   - *.test.ts / *.spec.ts (テスト)
 *   - src/lib/domain/labels.ts (atom / compound SSOT)
 *
 * baseline 機構: scripts/check-internal-terms-baseline.json
 *   - 既存違反を pin (本 EPIC 完了時点の状態)
 *   - 新規 1 件で fail
 *
 * 既存パターン継承: scripts/check-no-plan-literals.mjs (#972) /
 *                  scripts/check-lp-inline-style.mjs (#1851)
 *
 * 使用法: node scripts/check-internal-terms.mjs
 * CI: エラー検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// INTERNAL_TERMS_BANLIST
// ---------------------------------------------------------------------------

const INTERNAL_TERMS_BANLIST = [
	// インフラ・実装基盤
	{ pattern: 'DynamoDB', category: 'infra' },
	{ pattern: 'SQLite', category: 'infra' },
	{ pattern: 'CloudFront', category: 'infra' },
	{ pattern: 'EventBridge', category: 'infra' },
	// 設計・運用語彙
	{ pattern: 'Pre-PMF', category: 'design' },
	{ pattern: 'Bucket A', category: 'design' },
	{ pattern: 'Bucket B', category: 'design' },
	{ pattern: 'Bucket C', category: 'design' },
	// SaaS マーケ語彙
	{ pattern: 'アクティベーションファネル', category: 'saas-marketing' },
	{ pattern: 'リテンションコホート', category: 'saas-marketing' },
	{ pattern: 'Sean Ellis', category: 'saas-marketing' },
	{ pattern: 'チャーン', category: 'saas-marketing' },
	// 開発内部名
	// 注: 「テナント」は ops では許容 (運用者向け)、admin / 親 UI では「家庭」を使う (#2285 移動時に置換済)
	{ pattern: 'テナント', category: 'dev-internal' },
];

// ---------------------------------------------------------------------------
// CONN_INFO_BANLIST (#2987) — NUC 接続情報 (LAN IP / SSH user) の再混入検知
//
// 公開 repo への実値直書きを禁止し、docs/runbook は <NUC_HOST> / <NUC_USER>
// プレースホルダー、script は env (NUC_SSH_HOST / NUC_SSH_USER) 経由に統一済。
// 本 group はその再混入を CI で検出する (専用 script 新設は #1442 違反のため
// 本 script に config 駆動で相乗り — docs/CLAUDE.md §docs SSOT 原則)。
//
// - regex は escape 表記で構成し、検出対象の実値リテラルを本 script に含めない
// - comment 行も検査対象 (UI 用語と異なり comment 中の混入も情報漏洩)
// - baseline なし — 新規 1 件で即 fail (#2987 で残存 0 化済)
// ---------------------------------------------------------------------------

const CONN_INFO_BANLIST = [
	{
		regex: /192\.168\.68\.(?:79|0\/23)/,
		label: '<NUC_HOST> (NUC LAN IP / subnet)',
		category: 'conn-info',
	},
	{ regex: /kusaka[-]server/, label: '<NUC_USER> (NUC SSH user)', category: 'conn-info' },
];
// ---------------------------------------------------------------------------
// WORKFLOW_LANE_COVERAGE (#2948) — 全 workflow が gate × lane 対応表に記載済か検証
//
// docs/sessions/branch-strategy.md §4「全 workflow の gate × lane 対応表」が
// 全 .github/workflows/*.yml の SSOT。新規 workflow を追加したのに対応表へ行を
// 足さない場合に CI fail させる (専用 script 新設は #1442 / ADR-0010 で抑制対象の
// ため、config 駆動の本 script に conn-info group と同型で相乗りする)。
//
// 最小実装: 「.github/workflows/*.yml のファイル名集合 ⊆ 対応表に出現するファイル名集合」
// の差分検出のみ (#2948 no-go: lane 帰属の妥当性判定までは広げない、人手 + 表 SSOT)。
// baseline なし — 未記載 1 件で即 fail。
// ---------------------------------------------------------------------------

const WORKFLOWS_DIR = '.github/workflows';
const LANE_TABLE_DOC = 'docs/sessions/branch-strategy.md';
// 対応表セルの `workflow.yml` (バッククォート囲み) を抽出する。表外の散文記載も
// 拾えるよう、doc 全文から `<name>.yml` / `<name>.yaml` リテラルを網羅収集する。
const WORKFLOW_FILENAME_REGEX = /([\w.-]+\.ya?ml)/g;

const CONN_INFO_ROOTS = ['docs', 'scripts', '.github', 'infra', 'site', 'src', 'tests'];
const CONN_INFO_EXTENSIONS = [
	'.md',
	'.sh',
	'.mjs',
	'.cjs',
	'.js',
	'.ts',
	'.svelte',
	'.yml',
	'.yaml',
	'.json',
	'.html',
];

// ---------------------------------------------------------------------------
// SEARCH_ROOTS / EXCLUSIONS
//
// 親 UI (admin / 親管理画面) で内部用語の露出を検知する。
// ops / 内部 server 実装は除外 (運用者向け = 内部用語許容)。
// ---------------------------------------------------------------------------

const SEARCH_ROOTS = ['src/routes/(parent)', 'src/lib/features/admin'];
const EXTENSIONS = ['.ts', '.svelte'];

const EXCLUDE_PATTERNS = [
	// ops 配下 (内部用語許容)
	/src[\\/]routes[\\/]ops[\\/]/,
	// テストファイル
	/\.test\.(ts|mjs)$/,
	/\.spec\.ts$/,
	// SSOT 定義ファイル (検査対象ではない)
	/src[\\/]lib[\\/]domain[\\/]labels\.ts$/,
	/src[\\/]lib[\\/]domain[\\/]terms\.ts$/,
];

function shouldExclude(filePath) {
	const rel = path.relative(REPO_ROOT, filePath);
	return EXCLUDE_PATTERNS.some((p) => p.test(rel));
}

function walk(dir, out = [], extensions = EXTENSIONS, exclude = shouldExclude) {
	if (!fs.existsSync(dir)) return out;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		if (extensions.some((ext) => dir.endsWith(ext)) && !exclude(dir)) {
			out.push(dir);
		}
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
			walk(full, out, extensions, exclude);
		} else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
			if (!exclude(full)) out.push(full);
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// コメント行判定 (check-no-plan-literals.mjs と同パターン)
// ---------------------------------------------------------------------------

function isCommentLine(line) {
	const trimmed = line.trim();
	if (trimmed.startsWith('//')) return true;
	if (trimmed.startsWith('*')) return true;
	if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return true;
	if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) return true;
	if (trimmed.startsWith('<!--') && !trimmed.includes('-->')) return true;
	return false;
}

// ---------------------------------------------------------------------------
// Baseline 読込
// ---------------------------------------------------------------------------

const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/check-internal-terms-baseline.json');

function loadBaseline() {
	if (!fs.existsSync(BASELINE_PATH)) {
		return {};
	}
	try {
		const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
		return JSON.parse(raw);
	} catch (err) {
		console.error(`[check-internal-terms] baseline read error: ${err.message}`);
		return {};
	}
}

// ---------------------------------------------------------------------------
// 検査本体
// ---------------------------------------------------------------------------

function scanFile(filePath) {
	const text = fs.readFileSync(filePath, 'utf8');
	const lines = text.split(/\r?\n/);
	const hits = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (isCommentLine(line)) continue;
		for (const { pattern, category } of INTERNAL_TERMS_BANLIST) {
			if (line.includes(pattern)) {
				hits.push({
					line: i + 1,
					col: line.indexOf(pattern) + 1,
					pattern,
					category,
					snippet: line.trim().slice(0, 200),
				});
			}
		}
	}
	return hits;
}

function relPath(filePath) {
	return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// conn-info group 検査 (#2987)
// ---------------------------------------------------------------------------

function scanConnInfo() {
	const files = [];
	for (const root of CONN_INFO_ROOTS) {
		walk(path.join(REPO_ROOT, root), files, CONN_INFO_EXTENSIONS, () => false);
	}
	const violations = [];
	for (const f of files) {
		const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			for (const { regex, label, category } of CONN_INFO_BANLIST) {
				const m = lines[i].match(regex);
				if (m) {
					violations.push({
						file: relPath(f),
						line: i + 1,
						col: m.index + 1,
						pattern: label,
						category,
						snippet: lines[i].trim().slice(0, 200),
					});
				}
			}
		}
	}
	return { fileCount: files.length, violations };
}

// ---------------------------------------------------------------------------
// workflow-lane-coverage group 検査 (#2948)
// ---------------------------------------------------------------------------

function scanWorkflowLaneCoverage() {
	const workflowsDir = path.join(REPO_ROOT, WORKFLOWS_DIR);
	const docPath = path.join(REPO_ROOT, LANE_TABLE_DOC);

	// 実 workflow ファイル名集合
	let workflowFiles = [];
	try {
		workflowFiles = fs
			.readdirSync(workflowsDir)
			.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
	} catch (err) {
		return { ok: false, error: `workflows dir read error: ${err.message}`, missing: [] };
	}

	// 対応表 (doc 全文) に出現するファイル名集合
	const documented = new Set();
	try {
		const doc = fs.readFileSync(docPath, 'utf8');
		for (const m of doc.matchAll(WORKFLOW_FILENAME_REGEX)) {
			documented.add(m[1]);
		}
	} catch (err) {
		return { ok: false, error: `lane table doc read error: ${err.message}`, missing: [] };
	}

	// 実ファイル ⊆ 表記載 の差分 (表に行が無い workflow)
	const missing = workflowFiles.filter((f) => !documented.has(f)).sort();
	return { ok: missing.length === 0, workflowCount: workflowFiles.length, missing };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
	console.log('[check-internal-terms] AN-5 (#2180) 補強 — 親 UI 内部用語 UI 露出検査 (#2288)');

	// 1. 全ファイル収集
	const files = [];
	for (const root of SEARCH_ROOTS) {
		const fullRoot = path.join(REPO_ROOT, root);
		walk(fullRoot, files);
	}
	console.log(`[check-internal-terms] 検査対象ファイル数: ${files.length}`);

	// 2. 全違反収集
	const allHits = new Map(); // path -> hits[]
	for (const f of files) {
		const hits = scanFile(f);
		if (hits.length > 0) {
			allHits.set(relPath(f), hits);
		}
	}

	// 3. baseline と突き合わせ
	const baseline = loadBaseline();
	const newViolations = [];
	for (const [filePath, hits] of allHits) {
		const baselinePatterns = baseline[filePath] ?? [];
		for (const hit of hits) {
			if (!baselinePatterns.includes(hit.pattern)) {
				newViolations.push({ file: filePath, ...hit });
			}
		}
	}

	// 4. 結果出力
	const totalHits = [...allHits.values()].reduce((sum, hits) => sum + hits.length, 0);
	console.log(`[check-internal-terms] 全違反件数: ${totalHits} (baseline pin 済 + 新規違反含む)`);
	console.log(`[check-internal-terms] 新規違反件数: ${newViolations.length}`);

	// 5. conn-info group (#2987) — baseline なし、1 件で fail
	const connInfo = scanConnInfo();
	console.log(
		`[check-internal-terms] conn-info group (#2987): 検査 ${connInfo.fileCount} files / 違反 ${connInfo.violations.length} 件`,
	);
	if (connInfo.violations.length > 0) {
		console.log('\n[check-internal-terms] ✗ FAIL — NUC 接続情報の直書きが検出されました:\n');
		for (const v of connInfo.violations) {
			console.log(`  ${v.file}:${v.line}:${v.col}  [${v.category}] ${v.pattern}`);
			console.log(`    ${v.snippet}`);
		}
		console.log(
			'\n修正方針 (#2987):\n' +
				'  - docs / runbook → <NUC_HOST> / <NUC_USER> プレースホルダー表記に置換\n' +
				'  - script → env (NUC_SSH_HOST / NUC_SSH_USER) 経由化 (.env.example §NUC SSH 接続情報)\n' +
				'  - SSOT: docs/design/05-開発指針書.md §9「NUC 接続情報の管理」\n',
		);
		return 1;
	}

	// 6. workflow-lane-coverage group (#2948) — baseline なし、未記載 1 件で fail
	const laneCoverage = scanWorkflowLaneCoverage();
	if (laneCoverage.error) {
		console.log(
			`\n[check-internal-terms] ✗ FAIL — workflow-lane-coverage 検査エラー: ${laneCoverage.error}`,
		);
		return 1;
	}
	console.log(
		`[check-internal-terms] workflow-lane-coverage group (#2948): workflow ${laneCoverage.workflowCount} 本 / 未記載 ${laneCoverage.missing.length} 件`,
	);
	if (!laneCoverage.ok) {
		console.log(
			'\n[check-internal-terms] ✗ FAIL — gate × lane 対応表に未記載の workflow が検出されました:\n',
		);
		for (const f of laneCoverage.missing) {
			console.log(`  .github/workflows/${f}`);
		}
		console.log(
			'\n修正方針 (#2948):\n' +
				`  - 新規 workflow を追加したら ${LANE_TABLE_DOC} §4「全 workflow の gate × lane 対応表」に\n` +
				'    1 行追加する (lane 帰属 / required context 名 / lane 分岐有無 / 重量・軽量 を埋める)\n' +
				'  - required status check を生む job を追加した場合は ruleset (gh api .../rulesets/14673945) との\n' +
				'    整合も確認する (対応表 ★ 印 = ruleset の required_status_checks 配列と一致)\n',
		);
		return 1;
	}

	if (newViolations.length === 0) {
		console.log('[check-internal-terms] ✓ PASS — 新規違反 0 件');
		return 0;
	}

	console.log('\n[check-internal-terms] ✗ FAIL — 新規違反が検出されました:\n');
	for (const v of newViolations) {
		console.log(`  ${v.file}:${v.line}:${v.col}  [${v.category}] "${v.pattern}"`);
		console.log(`    ${v.snippet}`);
	}
	console.log(
		'\n修正方針:\n' +
			'  - 親 UI (admin / 親管理画面) で内部用語を露出させない (AN-5 #2180 観察 1)\n' +
			'  - 「DynamoDB」「Pre-PMF Bucket A」「アクティベーションファネル」等は labels.ts compound から削除\n' +
			'  - 「テナント」は admin では「家庭」/「家族」に置換 (ADR-0045 用語整合)\n' +
			'  - 運用者向け機能は /ops/* 配下に移動 (allowlist 対象)\n' +
			'\n  baseline 更新が必要な場合 (撤去前の状態 pin):\n' +
			`    手動編集: scripts/check-internal-terms-baseline.json\n` +
			'    {  "<file path>": ["<pattern>"]  } の形式\n',
	);
	return 1;
}

const code = main();
process.exit(code);
