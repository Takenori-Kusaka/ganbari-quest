#!/usr/bin/env node

/**
 * scripts/optimize-lp-images.mjs (#1907 TECH-E-1〜10)
 *
 * LP 巨大画像 (`logo-compact.png` 776KB / `ogp.png` 813KB / `icon-character.png` 494KB)
 * を sharp で圧縮し、`hero-illustration.png` (572KB、`.webp` のみ参照される dead asset) を削除する。
 *
 * 設計方針 (Issue #1907):
 *   - 既存依存 sharp で完結 (ADR-0010 §7 軽量 OSS 優先、ADR-0014 既存依存ゼロ追加)
 *   - 視覚的変化なし (PR で SS 4 スロット比較で証跡)
 *   - 決定的: 同 input → 同 output (CI 再現性)
 *   - SSOT: site/ と static/ の双方を同期更新
 *
 * 使用法:
 *   node scripts/optimize-lp-images.mjs           # 圧縮実行 + dead asset 削除
 *   node scripts/optimize-lp-images.mjs --check   # サイズ閾値検証のみ (read-only、CI 用)
 *   node scripts/optimize-lp-images.mjs --report  # before/after サイズ表示
 *
 * 圧縮ターゲット:
 *   logo-compact.png (1316x535 RGBA) → 320x130 PNG palette (≤100KB)
 *     LP header `<img height="44">` 表示、最大 desktop で 2x ≈ 264px width 程度
 *   ogp.png (1200x630 RGB)            → 1200x630 PNG palette colors=128 (≤200KB)
 *     OG meta image 専用、SNS 表示は 1200x630 固定で十分
 *   icon-character.png (639x675 RGBA) → 480x507 PNG palette (≤200KB)
 *     Logo.svelte symbol variant + AdventureStartOverlay (display 48-300px 程度)
 *   hero-illustration.png             → 削除 (.webp 参照のみ、dead asset confirmed)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const isCheck = args.includes('--check');
const isReport = args.includes('--report');

/**
 * 各ファイルの最適化定義。
 * sourcePath は SSOT (元画像)、targets は同内容を配備する全パス。
 */
const PLAN = [
	{
		name: 'logo-compact.png',
		// LP 全 11 ページ + Logo.svelte で参照 (header height=44px)
		// 元: 1316x535 RGBA 776KB → 320x130 で 2x retina 対応 + palette 化
		sourcePath: 'site/logo-compact.png',
		targets: ['site/logo-compact.png', 'static/logo-compact.png'],
		maxBytes: 100 * 1024,
		optimize: async (input) =>
			sharp(input)
				.resize({ width: 320, withoutEnlargement: true })
				.png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
				.toBuffer(),
	},
	{
		name: 'ogp.png',
		// OG image 専用 (1200x630 SNS 表示固定)
		// 元: 1200x630 RGB 813KB → 同サイズ palette PNG (colors=128)
		// 注: og:image PNG → JPEG 切替は LP 11 ファイルの href 変更が必要なため PNG 維持
		// 128 色 palette で SNS シェア用途には十分な視覚品質を保つ
		sourcePath: 'site/ogp.png',
		targets: ['site/ogp.png'],
		maxBytes: 200 * 1024,
		optimize: async (input) =>
			sharp(input).png({ palette: true, colors: 128, compressionLevel: 9, effort: 10 }).toBuffer(),
	},
	{
		name: 'icon-character.png',
		// Logo.svelte symbol + AdventureStartOverlay + pamphlet で参照
		// 元: 639x675 RGBA 494KB → 480x507 (24x retina 余裕) + palette 化
		sourcePath: 'site/icon-character.png',
		targets: ['site/icon-character.png', 'static/icon-character.png'],
		maxBytes: 200 * 1024,
		optimize: async (input) =>
			sharp(input)
				.resize({ width: 480, withoutEnlargement: true })
				.png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
				.toBuffer(),
	},
];

/** dead asset (参照ゼロ確認済) */
const DEAD_ASSETS = ['site/hero-illustration.png'];

const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;

function statSize(rel) {
	const abs = path.resolve(REPO_ROOT, rel);
	return fs.existsSync(abs) ? fs.statSync(abs).size : 0;
}

function readBefore() {
	const before = {};
	for (const p of PLAN) before[p.name] = statSize(p.sourcePath);
	for (const d of DEAD_ASSETS) before[d] = statSize(d);
	return before;
}

async function runOptimize() {
	const before = readBefore();
	const results = [];

	for (const plan of PLAN) {
		const srcAbs = path.resolve(REPO_ROOT, plan.sourcePath);
		if (!fs.existsSync(srcAbs)) {
			console.warn(`[skip] ${plan.sourcePath} not found`);
			continue;
		}
		const srcBuf = fs.readFileSync(srcAbs);
		const optBuf = await plan.optimize(srcBuf);
		const beforeBytes = before[plan.name];
		const afterBytes = optBuf.length;

		// 圧縮で逆に増えた場合 (ありえない場合の保険) は元を維持
		if (afterBytes >= beforeBytes) {
			console.warn(
				`[warn] ${plan.name}: optimize did not reduce size (${fmt(beforeBytes)} → ${fmt(afterBytes)}), keeping original`,
			);
			continue;
		}

		// 全 target に書き込む
		for (const t of plan.targets) {
			const tAbs = path.resolve(REPO_ROOT, t);
			fs.mkdirSync(path.dirname(tAbs), { recursive: true });
			fs.writeFileSync(tAbs, optBuf);
		}

		results.push({
			name: plan.name,
			before: beforeBytes,
			after: afterBytes,
			reduction: beforeBytes - afterBytes,
			pct: ((1 - afterBytes / beforeBytes) * 100).toFixed(1),
			thresholdOK: afterBytes <= plan.maxBytes,
			maxBytes: plan.maxBytes,
		});
	}

	// dead asset 削除
	const deadResults = [];
	for (const d of DEAD_ASSETS) {
		const abs = path.resolve(REPO_ROOT, d);
		if (fs.existsSync(abs)) {
			const size = fs.statSync(abs).size;
			fs.unlinkSync(abs);
			deadResults.push({ name: d, size });
		}
	}

	return { results, deadResults };
}

function runCheck() {
	const issues = [];
	for (const plan of PLAN) {
		const size = statSize(plan.sourcePath);
		if (size === 0) {
			issues.push(`[missing] ${plan.sourcePath}`);
			continue;
		}
		if (size > plan.maxBytes) {
			issues.push(
				`[over-threshold] ${plan.name}: ${fmt(size)} > ${fmt(plan.maxBytes)} (run 'node scripts/optimize-lp-images.mjs')`,
			);
		}
	}
	for (const d of DEAD_ASSETS) {
		if (fs.existsSync(path.resolve(REPO_ROOT, d))) {
			issues.push(`[dead-asset] ${d} still exists (run 'node scripts/optimize-lp-images.mjs')`);
		}
	}
	return issues;
}

function printReport(_before, results, deadResults) {
	console.log('\n=== LP 画像最適化レポート (#1907) ===\n');
	console.log('| ファイル | Before | After | 削減 | 削減率 | 閾値 |');
	console.log('|---|---|---|---|---|---|');
	let totalBefore = 0;
	let totalAfter = 0;
	for (const r of results) {
		totalBefore += r.before;
		totalAfter += r.after;
		console.log(
			`| ${r.name} | ${fmt(r.before)} | ${fmt(r.after)} | ${fmt(r.reduction)} | ${r.pct}% | ${r.thresholdOK ? 'OK' : 'NG'} ${fmt(r.maxBytes)} |`,
		);
	}
	for (const d of deadResults) {
		totalBefore += d.size;
		console.log(`| ${d.name} (dead) | ${fmt(d.size)} | (deleted) | ${fmt(d.size)} | 100.0% | OK |`);
	}
	const totalReduction = totalBefore - totalAfter;
	const totalPct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : '0';
	console.log(
		`\n合計: ${fmt(totalBefore)} -> ${fmt(totalAfter)} (${fmt(totalReduction)} 削減, ${totalPct}%)`,
	);
}

async function main() {
	if (isCheck) {
		const issues = runCheck();
		if (issues.length > 0) {
			console.error('LP 画像サイズ閾値違反:');
			for (const i of issues) console.error(`  ${i}`);
			process.exit(1);
		}
		console.log('LP 画像サイズ閾値: PASS');
		return;
	}

	const before = readBefore();
	if (isReport) {
		console.log('\n=== Before ===');
		for (const [k, v] of Object.entries(before)) console.log(`  ${k}: ${fmt(v)}`);
		return;
	}

	console.log('LP 画像最適化を開始します...\n');
	const { results, deadResults } = await runOptimize();
	printReport(before, results, deadResults);

	// 閾値超過チェック
	const overs = results.filter((r) => !r.thresholdOK);
	if (overs.length > 0) {
		console.error('\n閾値超過:');
		for (const o of overs) {
			console.error(`  ${o.name}: ${fmt(o.after)} > ${fmt(o.maxBytes)}`);
		}
		process.exit(1);
	}
	console.log('\n全 AC PASS');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
