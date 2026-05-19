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

function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		if (EXTENSIONS.some((ext) => dir.endsWith(ext)) && !shouldExclude(dir)) {
			out.push(dir);
		}
		return out;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			if (!shouldExclude(full)) out.push(full);
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
