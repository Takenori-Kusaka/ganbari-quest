#!/usr/bin/env node
// scripts/take-lp-screenshots.mjs
//
// LP スクリーンショット "compare / promote" 専用ツール (#1129)。
// - デフォルトは `tmp/screenshots-staging/` に撮影して既存 `site/screenshots/` と
//   ファイルサイズ差分を比較 (デグレ検知)。
// - `--promote` で staging を本番パスにコピー。
//
// ※ LP 本番用スクリーンショットの生成は `scripts/capture-hp-screenshots.mjs` が SSOT。
//    CI (`.github/workflows/pages.yml`) はそちらを呼ぶ。詳細は
//    `docs/design/lp-deploy-pipeline.md` 参照。
// ※ 本スクリプトは `npm run screenshots:lp:compare` から呼ばれる (#1283)。
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import {
	convertToWebP,
	waitForStablePage,
	withScreenshotParam,
} from './lib/screenshot-helpers.mjs';

const log = (...a) => console.log(...a);
const logErr = (...a) => console.error(...a);

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [k, v] = a.replace(/^--/, '').split('=');
			return [k, v ?? 'true'];
		}),
);

const BASE_URL = args['base-url'] || 'http://localhost:5173';
const PROD_DIR = resolve(args.output || 'site/screenshots');
const COMPARE_MODE = args.compare === 'true' || args['compare-only'] === 'true';
const COMPARE_ONLY = args['compare-only'] === 'true';
const STAGING_DIR = resolve(args['staging-dir'] || 'tmp/screenshots-staging');
const SIZE_THRESHOLD = Number.parseInt(args.threshold || '30', 10);
const TARGET_MODE = args.mode || null;

const OUTPUT_DIR = COMPARE_MODE ? STAGING_DIR : PROD_DIR;

const AGE_MODES = [
	{ mode: 'preschool', filePrefix: 'age-kinder', label: '幼児 (3-5歳)' },
	{ mode: 'elementary', filePrefix: 'age-lower', label: '小学生 (6-12歳)' },
	{ mode: 'junior', filePrefix: 'age-upper', label: '中学生 (13-15歳)' },
	{ mode: 'senior', filePrefix: 'age-teen', label: '高校生 (16-18歳)' },
];

const VIEWPORTS = {
	mobile: { width: 390, height: 844 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1280, height: 800 },
};

const HERO_SCREENSHOTS = [
	{ url: '/demo/preschool/home', file: 'hero-child-home', label: 'ヒーロー: 子供ホーム' },
];

const CAROUSEL_SCREENSHOTS = [
	{ url: '/demo/preschool/home', file: 'carousel-1-child-home', label: 'カルーセル1: 子供ホーム' },
	{
		url: '/demo/preschool/status',
		file: 'carousel-2-child-status',
		label: 'カルーセル2: 子供ステータス',
	},
	{ url: '/demo/admin', file: 'carousel-3-admin-main', label: 'カルーセル3: 管理画面メイン' },
	{
		url: '/demo/admin/activities',
		file: 'carousel-4-admin-sub',
		label: 'カルーセル4: 管理画面サブ',
	},
];

const FEATURE_SCREENSHOTS = [
	{ url: '/demo/preschool/home', file: 'feature-point-level', label: '機能: ポイント・レベル' },
	{ url: '/demo/preschool/home', file: 'feature-combo-mission', label: '機能: コンボ・ミッション' },
	{ url: '/demo/elementary/status', file: 'feature-radar-chart', label: '機能: レーダーチャート' },
	{
		url: '/demo/admin/reports',
		file: 'feature-growth-record-admin',
		label: '機能: 成長記録(管理)',
	},
	{ url: '/demo/elementary/achievements', file: 'feature-titles', label: '機能: 称号' },
	{
		url: '/demo/checklist',
		file: 'feature-belongings-checklist',
		label: '機能: 持ち物チェックリスト',
	},
];

async function waitForApp(page) {
	try {
		await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
			timeout: 15000,
		});
	} catch {
		// `window.__APP_HYDRATED__` が立たない route は DOM の主要要素で代替待機
		await page.waitForSelector('body > *', { state: 'visible', timeout: 5000 }).catch(() => {});
	}
}

async function captureAgeMode(browser, { mode, filePrefix }) {
	const url = `${BASE_URL}${withScreenshotParam(`/demo/${mode}/home`)}`;

	for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
		const suffix = vpName === 'mobile' ? '' : `-${vpName}`;
		const ctx = await browser.newContext({ viewport });
		const page = await ctx.newPage();

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
		await waitForApp(page);
		await waitForStablePage(page, { skipNetworkIdle: true });

		const filePath = `${OUTPUT_DIR}/${filePrefix}${suffix}.webp`;
		await page.screenshot({ path: filePath, fullPage: false, type: 'png' });
		await convertToWebP(filePath);

		log(`  OK ${vpName} -> ${filePrefix}${suffix}.webp`);
		await ctx.close();
	}
}

async function captureGeneric(browser, screenshots, viewportKeys, mobileSuffix = '') {
	for (const { url, file } of screenshots) {
		for (const vpName of viewportKeys) {
			const suffix = vpName === 'mobile' ? mobileSuffix : `-${vpName}`;
			const viewport = VIEWPORTS[vpName];
			const ctx = await browser.newContext({ viewport });
			const page = await ctx.newPage();

			await page.goto(`${BASE_URL}${withScreenshotParam(url)}`, {
				waitUntil: 'domcontentloaded',
				timeout: 60000,
			});
			await waitForApp(page);
			await waitForStablePage(page, { skipNetworkIdle: true });

			const filePath = `${OUTPUT_DIR}/${file}${suffix}.webp`;
			await page.screenshot({ path: filePath, fullPage: false, type: 'png' });
			await convertToWebP(filePath);

			log(`  OK ${vpName} -> ${file}${suffix}.webp`);
			await ctx.close();
		}
	}
}

function classifyFile(prodPath, stagingPath, threshold) {
	const prodSize = statSync(prodPath).size;
	const stagingSize = statSync(stagingPath).size;
	const diffPercent = Math.round(((stagingSize - prodSize) / prodSize) * 100);
	const sign = diffPercent > 0 ? '+' : '';

	if (stagingSize === 0) {
		return { status: 'ERROR', message: '空ファイル（撮影失敗の可能性）' };
	}
	if (Math.abs(diffPercent) > threshold) {
		return {
			status: 'WARN',
			message: `サイズ差 ${sign}${diffPercent}% (${prodSize}->${stagingSize} bytes)`,
		};
	}
	return {
		status: 'OK',
		message: `差異 ${sign}${diffPercent}% (${prodSize}->${stagingSize})`,
	};
}

function countByStatus(results) {
	const counts = { ok: 0, warn: 0, error: 0, missing: 0, new: 0 };
	const statusMap = { OK: 'ok', WARN: 'warn', ERROR: 'error', MISSING: 'missing', NEW: 'new' };
	for (const r of results) {
		const key = statusMap[r.status];
		if (key) counts[key]++;
	}
	return counts;
}

function summarizeAndPrint(results, stagingDir, threshold) {
	const icons = { OK: '[OK]', WARN: '[WARN]', ERROR: '[ERR]', MISSING: '[MISS]', NEW: '[NEW]' };
	for (const r of results) {
		log(`  ${icons[r.status]} ${r.file}: ${r.message}`);
	}

	const counts = countByStatus(results);
	log(
		`\n[Summary] OK:${counts.ok} WARN:${counts.warn} ERR:${counts.error} MISS:${counts.missing} NEW:${counts.new}`,
	);

	const reportPath = join(stagingDir, 'comparison-report.json');
	const report = {
		timestamp: new Date().toISOString(),
		threshold: `${threshold}%`,
		summary: counts,
		details: results,
	};
	mkdirSync(stagingDir, { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	log(`  レポート: ${reportPath}`);

	if (counts.error > 0) {
		log('\n[FAIL] エラーあり。撮影に問題がある可能性。');
	} else if (counts.warn > 0) {
		log('\n[WARN] サイズ差異が大きいファイルあり。確認してください。');
	} else {
		log('\n[PASS] 全ファイルが閾値内です。');
	}

	return counts;
}

function compareScreenshots(stagingDir, prodDir, threshold) {
	log('\n[Compare] デグレーション比較');
	log(`  既存: ${prodDir}`);
	log(`  新規: ${stagingDir}`);
	log(`  閾値: +/-${threshold}%\n`);

	if (!existsSync(prodDir)) {
		log('  ! 既存スクリーンショットなし。比較スキップ。');
		return { pass: true, results: [] };
	}

	const prodFiles = readdirSync(prodDir).filter((f) => f.endsWith('.webp'));
	const stagingFiles = existsSync(stagingDir)
		? readdirSync(stagingDir).filter((f) => f.endsWith('.webp'))
		: [];

	const results = [];

	for (const file of prodFiles) {
		const prodPath = join(prodDir, file);
		const stagingPath = join(stagingDir, file);

		if (!existsSync(stagingPath)) {
			results.push({ file, status: 'MISSING', message: '新規撮影に含まれていない' });
			continue;
		}

		const result = classifyFile(prodPath, stagingPath, threshold);
		results.push({ file, ...result });
	}

	for (const file of stagingFiles) {
		if (!prodFiles.includes(file)) {
			const size = statSync(join(stagingDir, file)).size;
			results.push({ file, status: 'NEW', message: `新規ファイル (${size} bytes)` });
		}
	}

	const counts = summarizeAndPrint(results, stagingDir, threshold);
	return { pass: counts.error === 0, results };
}

function promoteStaging(stagingDir, prodDir) {
	if (!existsSync(stagingDir)) return;
	const files = readdirSync(stagingDir).filter((f) => f.endsWith('.webp'));
	for (const file of files) {
		copyFileSync(join(stagingDir, file), join(prodDir, file));
	}
	log(`\n${files.length} ファイルを ${prodDir} に反映しました。`);
}

(async () => {
	if (COMPARE_ONLY) {
		const { pass } = compareScreenshots(STAGING_DIR, PROD_DIR, SIZE_THRESHOLD);
		process.exit(pass ? 0 : 1);
	}

	mkdirSync(OUTPUT_DIR, { recursive: true });
	log('LP スクリーンショット撮影開始');
	log(`  Base URL: ${BASE_URL}`);
	log(`  Output:   ${OUTPUT_DIR}`);
	if (COMPARE_MODE) {
		log('  Mode:     比較モード（staging -> 比較 -> 反映確認）');
	}

	const browser = await chromium.launch();
	let captureSuccess = true;

	try {
		const modes = TARGET_MODE ? AGE_MODES.filter((m) => m.mode === TARGET_MODE) : AGE_MODES;

		log('\n--- 年齢モード別スクリーンショット ---');
		for (const ageModeConfig of modes) {
			log(`\n[${ageModeConfig.label}] (${ageModeConfig.mode})`);
			await captureAgeMode(browser, ageModeConfig);
		}

		if (!TARGET_MODE) {
			log('\n--- ヒーロー・カルーセルスクリーンショット ---');
			await captureGeneric(browser, HERO_SCREENSHOTS, ['mobile']);
			await captureGeneric(browser, CAROUSEL_SCREENSHOTS, ['mobile', 'desktop'], '-mobile');

			log('\n--- 機能スクリーンショット ---');
			await captureGeneric(browser, FEATURE_SCREENSHOTS, ['mobile', 'desktop']);
		}
	} catch (err) {
		logErr(`\n撮影中にエラー: ${err.message}`);
		captureSuccess = false;
	} finally {
		await browser.close();
	}

	if (!captureSuccess) {
		log('\n一部撮影に失敗しました。');
		process.exit(1);
	}

	log('\n撮影完了');

	if (COMPARE_MODE) {
		const { pass } = compareScreenshots(STAGING_DIR, PROD_DIR, SIZE_THRESHOLD);
		if (pass) {
			log('\n比較結果に問題はありません。');
			log('反映するには: node scripts/take-lp-screenshots.mjs --compare-only --promote');
		}
	}

	if (args.promote === 'true' && existsSync(STAGING_DIR)) {
		promoteStaging(STAGING_DIR, PROD_DIR);
	}
})();
