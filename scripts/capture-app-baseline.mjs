#!/usr/bin/env node

// scripts/capture-app-baseline.mjs
// アプリ本体 visual regression baseline 撮影 (CX-DoR #8 / ADR-0053 app 拡張)
//
// 目的:
//   既存 LP visual regression (scripts/lp-screenshot-baseline/、ADR-0053 pixelmatch) +
//   child-home visual regression (scripts/child-home-baseline/、#2520) で拾えていない
//   **アプリ本体 critical CUJ の age-mode 補完 + admin 画面** の visual baseline を撮影する。
//
//   #2520 (child-home-visual-regression) は child home 4 mode (preschool/elementary/junior/senior)
//   + battle 1 件をカバー済み。本 script は残ギャップを埋める:
//     1. baby home (#2520 未カバーの 5 番目 age mode、ADR-0011 準備モード)
//     2. admin 代表 critical 画面 (marketplace 取込 CUJ の受領先 = /admin/activities, /admin/checklists)
//     3. ページガイド open 状態 (#2928、EPIC #2925 Sub-3): ❓ を開いた driver.js popover の
//        settled 状態 (重複 / 見切れ / spotlight 不全の pixel 回帰検出)。代表 3 ページ × desktop + mobile。
//        scripts/lib/page-guide-capture.mjs の openPageGuide hook を ScreenshotCapture.capture({ interact })
//        に渡して撮影する (#1442 使い捨て禁止 — 既存 capture infra の generic 拡張)。
//
//   これにより「critical CUJ × 5 age mode + admin + ガイド open」の見た目回帰を pixelmatch で
//   機械検出する 3 層 (LP / child-home / app) の visual regression 体制が完成する。
//
// 前提:
//   preview server を AUTH_MODE=anonymous + DATA_SOURCE=demo で起動していること
//   (`.github/workflows/app-visual-regression.yml` / child-home-visual-regression.yml と同構成)
//   ローカル検証: `AWS_LICENSE_SECRET=dummy AUTH_MODE=anonymous DATA_SOURCE=demo npm run preview -- --port 5173`
//
// 撮影方式 (ADR-0048 demo Lambda 同型):
//   本番ルート (`/(child)/[uiMode]/home` / `/(parent)/admin/...`) を demo fixture data で描画。
//   `selectedChildId` cookie を pre-set して `/(child)/+layout.server.ts` の `/switch` redirect を
//   バイパスする (capture-hp-screenshots.mjs と同じ deriveChildIdCookieFromUrl ロジックを共有)。
//
// 比較:
//   撮影結果 (tmp/app-baseline-current/*.webp) を scripts/app-screenshot-baseline/*.webp と
//   `scripts/check-lp-visual-regression.mjs --baseline-dir ... --current-dir ...` で pixelmatch 比較。
//   (#2520 と同様、check-lp-visual-regression.mjs の汎用 pixelmatch ロジックを再利用 = 使い捨て禁止 #1442)
//
// CLI:
//   node scripts/capture-app-baseline.mjs --webp              # tmp/app-baseline-current/ に撮影
//   node scripts/capture-app-baseline.mjs --webp --only admin # group 絞り込み
//   node scripts/capture-app-baseline.mjs --webp --update-baseline
//                                                             # 撮影 + scripts/app-screenshot-baseline/ に上書き
//
// 関連:
//   - scripts/check-lp-visual-regression.mjs (汎用 pixelmatch 比較、ADR-0053)
//   - scripts/capture-hp-screenshots.mjs (撮影方式の参照元、#2097 PR-B1)
//   - scripts/child-home-baseline/ (#2520 child home baseline)
//   - .github/workflows/app-visual-regression.yml (本 script の CI 統合)
//   - docs/decisions/0053-lp-visual-regression-pixelmatch.md §app 拡張

import fs from 'node:fs';
import path from 'node:path';
import { openPageGuide } from './lib/page-guide-capture.mjs';
import { ScreenshotCapture } from './lib/screenshot-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const CURRENT_DIR = path.resolve('tmp/app-baseline-current');
const BASELINE_DIR = path.resolve('scripts/app-screenshot-baseline');

// ============================================================
// Viewport (mobile 中心、Pre-PMF #2520 と整合)
// ============================================================
//
// LP 側は desktop も担保済み (scripts/lp-screenshot-baseline/*-desktop.webp)。
// アプリ本体 home / admin 一覧は mobile 優先 (主要 user は mobile、Pre-PMF ADR-0010 最小スコープ)。
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 };
// ガイド open 状態のみ desktop も撮る (#2928 AC1)。driver.js の collision 回避は viewport 幅依存で
// 配置が変わるため、mobile 狭幅 / desktop 広幅の双方で「重複 / 見切れ / spotlight」回帰を pixel 検出する。
// page-guide-layout-invariant.spec.ts (#2926) の VIEWPORTS と同値 (desktop 1280x800)。
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1 };

// ============================================================
// Demo fixture child IDs (SSOT: src/lib/server/demo/demo-data.ts)
// capture-hp-screenshots.mjs CHILD_ID_BY_UI_MODE と同値
// ============================================================
const CHILD_ID_BY_UI_MODE = {
	baby: '901',
	preschool: '902',
	elementary: '903',
	junior: '904',
	senior: '906',
};

/**
 * URL から uiMode を判定し対応する selectedChildId cookie 仕様を返す。
 * admin / checklist は全 child 横断のため cookie 不要。
 * (capture-hp-screenshots.mjs deriveChildIdCookieFromUrl と同ロジック)
 */
function deriveChildIdCookieFromUrl(urlPath) {
	const queryMatch = urlPath.match(/[?&]childId=(\d+)/);
	if (queryMatch) {
		return [{ name: 'selectedChildId', value: queryMatch[1] }];
	}
	const segMatch = urlPath.match(/^\/?([a-z]+)\b/);
	if (segMatch) {
		const childId = CHILD_ID_BY_UI_MODE[segMatch[1]];
		if (childId) return [{ name: 'selectedChildId', value: childId }];
	}
	return undefined;
}

// ============================================================
// Screenshot 定義 (critical CUJ × age mode 補完 + admin)
// ============================================================
//
// #2520 child-home-baseline 重複回避:
//   preschool/elementary/junior/senior home は既に child-home-visual-regression.yml で
//   carve 済 (growth-stage-<mode> → child-home-<mode>)。本 script は baby home のみ home を撮る。
//
// scope (Pre-PMF ADR-0010、過剰 matrix 回避):
//   - baby home (#2520 未カバーの 5 番目 age mode を補完)
//   - admin/activities (marketplace 取込 CUJ 受領先 / add 経路集約画面、DESIGN.md §10)
//   - admin/checklists (marketplace 取込 CUJ 受領先、in-page UnifiedImportHub)
//   mobile 1 viewport のみ (desktop は LP で担保、Pre-PMF mobile 優先)
//
// #2928 (EPIC #2925 Sub-3): ガイド open 状態 baseline を追加。
//   各 spec の `interact` が ❓ を click → driver.js popover を settled 状態にしてから撮る。
//   `fullPage: false` (バブル位置は viewport 相対 + driver.js fixed overlay のため viewport 撮影)。
//   代表ページ = /admin/activities (PO 実機指摘の起点、必須) + /admin/checklists + /admin/status
//   を desktop + mobile で撮る (全 11 ページ × 全 step は no-go、網羅は invariant E2E が担う)。
const SPECS = [
	{
		group: 'age',
		name: 'app-baby-home',
		url: '/baby/home',
	},
	{
		group: 'admin',
		name: 'app-admin-activities',
		url: '/admin/activities',
	},
	{
		group: 'admin',
		name: 'app-admin-checklists',
		url: '/admin/checklists',
	},
	// ガイド open 状態 (#2928 AC1)。desktop + mobile を別 spec として展開。
	...[
		{ url: '/admin/activities', slug: 'admin-activities' },
		{ url: '/admin/checklists', slug: 'admin-checklists' },
		{ url: '/admin/status', slug: 'admin-status' },
	].flatMap(({ url, slug }) =>
		[
			{ vp: MOBILE, suffix: 'mobile' },
			{ vp: DESKTOP, suffix: 'desktop' },
		].map(({ vp, suffix }) => ({
			group: 'guide',
			name: `app-guide-${slug}-${suffix}`,
			url,
			viewport: vp,
			fullPage: false,
			interact: openPageGuide,
		})),
	),
];

// ============================================================
// CLI
// ============================================================

function parseArgs(argv) {
	const args = { webp: false, only: null, updateBaseline: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--webp') args.webp = true;
		else if (a === '--update-baseline') args.updateBaseline = true;
		else if (a === '--only') args.only = argv[++i];
		else if (a === '--help' || a === '-h') {
			printHelp();
			process.exit(0);
		}
	}
	return args;
}

function printHelp() {
	console.log(`Usage: node scripts/capture-app-baseline.mjs [options]

アプリ本体 visual regression baseline 撮影 (CX-DoR #8 / ADR-0053 app 拡張)。

前提: preview server を AUTH_MODE=anonymous + DATA_SOURCE=demo で起動 (port 5173)。

Options:
  --webp              PNG 撮影後に WebP 変換 (baseline は webp、pixelmatch 比較対象)。
  --only <group>      撮影対象 group を絞り込む (age / admin / guide)。
  --update-baseline   撮影後 tmp/app-baseline-current/ を scripts/app-screenshot-baseline/ に上書き。
  -h, --help          このヘルプを表示。

撮影対象 (mobile 390x844 / guide は desktop 1280x800 も):
${SPECS.map((s) => `  - ${s.name.padEnd(34)} ${s.url} (${s.group})`).join('\n')}
`);
}

// ============================================================
// Main
// ============================================================

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const targets = args.only ? SPECS.filter((s) => s.group === args.only) : SPECS;
	if (targets.length === 0) {
		console.error(`Error: --only ${args.only} に一致する spec がありません。`);
		console.error(`  有効な group: ${[...new Set(SPECS.map((s) => s.group))].join(', ')}`);
		process.exit(2);
	}

	fs.mkdirSync(CURRENT_DIR, { recursive: true });

	const capture = new ScreenshotCapture({
		baseUrl: BASE_URL,
		outputDir: CURRENT_DIR,
		// DOM snapshot は visual regression 用途では不要 (pixelmatch は webp のみ比較)
		domSnapshot: false,
	});
	await capture.setup();

	let failed = 0;
	try {
		for (const spec of targets) {
			const cookies = deriveChildIdCookieFromUrl(spec.url);
			// 本番一致演出を強制 ON + demo 固有 UI 非表示 (?screenshot=all、#1893)
			const url = spec.url.includes('?')
				? `${spec.url}&screenshot=all`
				: `${spec.url}?screenshot=all`;
			const result = await capture.capture({
				url,
				name: spec.name,
				// guide spec は spec ごとに desktop / mobile を指定。それ以外は mobile 既定。
				viewport: spec.viewport ?? MOBILE,
				format: args.webp ? 'webp' : 'png',
				// guide spec はバブルが viewport 相対のため viewport 撮影。それ以外は fullPage。
				fullPage: spec.fullPage ?? true,
				...(cookies ? { cookies } : {}),
				...(spec.interact ? { interact: spec.interact } : {}),
				// #3012: error ページ (500 / +error.svelte / infra/error-pages) を baseline として
				// 撮影しない。違反時は当該 spec が FAIL になり exit 1 + baseline 更新も中止される。
				renderHealthCheck: true,
			});
			if (result.ok) {
				console.log(`  [OK]   ${spec.name.padEnd(24)} ${spec.url} (${result.size} bytes)`);
			} else {
				console.error(`  [FAIL] ${spec.name.padEnd(24)} ${spec.url}: ${result.error.message}`);
				failed++;
			}
		}
	} finally {
		await capture.teardown();
	}

	console.log(`\n撮影完了: ${targets.length - failed}/${targets.length} 件 → ${CURRENT_DIR}`);

	if (args.updateBaseline) {
		// #3012: 撮影 fail (render 健全性違反含む) があるまま baseline を部分更新しない。
		// 壊れた画面 / 欠落した spec が baseline に混入・凍結されるのを防ぐ。
		if (failed > 0) {
			console.error(
				`❌ 撮影 ${failed} 件 fail のため baseline 更新を中止しました (#3012)。fail 原因を修正して再実行してください。`,
			);
			process.exit(1);
		}
		fs.mkdirSync(BASELINE_DIR, { recursive: true });
		const ext = args.webp ? '.webp' : '.png';
		let copied = 0;
		for (const spec of targets) {
			const src = path.join(CURRENT_DIR, `${spec.name}${ext}`);
			if (fs.existsSync(src)) {
				fs.copyFileSync(src, path.join(BASELINE_DIR, `${spec.name}${ext}`));
				copied++;
			}
		}
		console.log(`✅ baseline 更新完了: ${copied} 件 → ${BASELINE_DIR}`);
		console.log('   commit して PR に同梱してください (visual baseline は git tracked です)。');
	}

	if (failed > 0) {
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(2);
});
