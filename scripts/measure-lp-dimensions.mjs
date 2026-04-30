#!/usr/bin/env node

// LP (site/index.html) の寸法・禁止用語・CTA 文言バリエーションを計測 (#1163)
//
// 使い方:
//   node scripts/measure-lp-dimensions.mjs [--site-dir=site] [--output=lp-metrics.json]
//
// 出力:
//   - JSON を stdout に出力
//   - --output で指定したファイル（既定: lp-metrics.json）にも保存
//
// 終了コード:
//   閾値違反があれば 1、問題なければ 0

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

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

const SITE_DIR = resolve(args['site-dir'] || 'site');
const OUTPUT_PATH = resolve(args.output || 'lp-metrics.json');
// #1637 R34: TARGET_HTML を配列化し全 site/ HTML をスキャン対象に
// --target=index.html で単一指定も可能（後方互換）
const TARGET_HTML_LIST = args.target
	? args.target.split(',')
	: ['index.html', 'pamphlet.html', 'pricing.html', 'faq.html', 'privacy.html'];

// #1088 / #1163 の禁止語（開発者向け語彙を LP に残さない）
// #1212-H / ADR-0041: 「マーケットプレイス」「マケプレ」→「みんなのテンプレート」「テンプレート」へ移行済。再混入を CI 検出
// #1286: 安心訴求セクションで「OSS / ソースコード / サーバー / 自前運用」を追加禁止（IT 非リテラシ親への伝達性を優先）。
//   例外: これらを本当に書きたいページ（selfhost.html 等）は TARGET_HTML として scan しないため影響なし
// #1313: 射幸性語彙を禁止（ADR-0012 Anti-engagement 原則 + ADR-0013 LP truth）。
//   「ガチャ」「抽選」「コンプリート」は親層が忌避するコンプガチャ連想語彙。
//   「ランダム」は将来の許容例が出る可能性があるため除外（別途判断）。
//
// #1637 R34: TARGET_HTML 拡張に伴い 2 系統の禁止語に分割
//   STRICT (全 site/ ページで禁止): ADR-0012 逆メッセージ + コンプガチャ連想 + 用語 SSOT 違反
//   IT_JARGON (index.html のみ禁止): #1286 「OSS / ソースコード / サーバー / 自前運用」 +
//     #1088 / #1163 のセルフホスト/インフラ用語。
//     selfhost.html / privacy.html / 法務系では正当な用途のため scope 外。
//
// #1629 R25 / #1637 R34: ADR-0012 Anti-engagement 原則への完全な逆メッセージ語彙を追加禁止。
//   「ゲーミフィケーション全開」「変動比率」「射幸」「メタ層」「コンボ」を一掃。
//   「L1」「L2」「L3」は #1615 R11 で「活動 / 習慣 / ごほうび」へ顧客語彙化済み（再混入禁止）。
// #1630 R26: 用語 SSOT。「シールくじ」→「おみくじスタンプ」へ統一。
const STRICT_FORBIDDEN_TERMS = [
	// コンプガチャ連想（#1313）
	'ガチャ',
	'抽選',
	'コンプリート',
	// ADR-0012 逆メッセージ（#1629 R25 / #1637 R34）
	'ゲーミフィケーション全開',
	'変動比率',
	'射幸',
	'メタ層',
	'コンボ',
	// #1615 R11 顧客語彙化済み（再混入防止）
	'L1',
	'L2',
	'L3',
	// #1630 R26 用語 SSOT
	'シールくじ',
	// #1706 R1 運営者主語の押し付け禁止（StoryBrand リフレーム / 主語は「がんばりクエスト」または「保護者」）
	'私たち',
	'わたしたち',
];

const IT_JARGON_FORBIDDEN_TERMS = [
	'git clone',
	'docker compose',
	'SaaS版',
	'セルフホスト版',
	'TLS',
	'AES-256',
	'AWS',
	'マーケットプレイス',
	'マケプレ',
	'OSS',
	'ソースコード',
	'サーバー',
	'自前運用',
];

// 後方互換: 既存テストや CI 参照用に統合配列も export 等価で残す
const FORBIDDEN_TERMS = [...IT_JARGON_FORBIDDEN_TERMS, ...STRICT_FORBIDDEN_TERMS];

// index.html のみ IT_JARGON も検証する。selfhost.html / privacy.html / faq.html / pamphlet.html /
// pricing.html では STRICT のみ検証。
function getForbiddenTermsForTarget(target) {
	if (target === 'index.html') {
		return FORBIDDEN_TERMS;
	}
	return STRICT_FORBIDDEN_TERMS;
}

const THRESHOLDS = {
	mobileHeight: 15200, // #1594: founder セクション ([08b]) 追加で 15113 超 → 15200 に ratchet 更新
	desktopHeight: 8000,
	ctaVariantsMax: 3,
};

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.xml': 'application/xml; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

function startStaticServer(rootDir) {
	return new Promise((resolvePromise, rejectPromise) => {
		const server = createServer((req, res) => {
			let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
			if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
			const filePath = join(rootDir, urlPath);
			// パス・トラバーサル対策
			if (!filePath.startsWith(rootDir)) {
				res.writeHead(403);
				res.end();
				return;
			}
			if (!existsSync(filePath) || !statSync(filePath).isFile()) {
				res.writeHead(404);
				res.end('Not Found');
				return;
			}
			const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
			res.writeHead(200, { 'Content-Type': mime });
			res.end(readFileSync(filePath));
		});
		server.on('error', rejectPromise);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				rejectPromise(new Error('Failed to bind static server'));
				return;
			}
			resolvePromise({ server, port: address.port });
		});
	});
}

function countForbiddenTerms(html, terms = FORBIDDEN_TERMS) {
	const counts = {};
	for (const term of terms) {
		const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const matches = html.match(new RegExp(escaped, 'g')) || [];
		counts[term] = matches.length;
	}
	return counts;
}

async function extractCtaVariants(page) {
	return await page.evaluate(() => {
		const anchors = document.querySelectorAll('a[href], button');
		const texts = new Map();
		const CTA_PATHS = ['/auth/signup', '/auth/login', '/demo'];
		for (const el of anchors) {
			const href = el.getAttribute('href') || '';
			const isCta = CTA_PATHS.some((p) => href.includes(p));
			if (!isCta) continue;
			const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			texts.set(txt, (texts.get(txt) || 0) + 1);
		}
		return [...texts.entries()].map(([text, count]) => ({ text, count }));
	});
}

async function measureHeight(page, url, width) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
	await waitForStablePage(page);
	return await page.evaluate(() => document.body.scrollHeight);
}

async function measureSingleTarget(page, port, targetHtml) {
	const url = `http://127.0.0.1:${port}/${targetHtml}`;
	log(`[measure] target: ${targetHtml}`);
	const mobileHeight = await measureHeight(page, url, 375);
	const ctaVariants = await extractCtaVariants(page);
	const desktopHeight = await measureHeight(page, url, 1280);
	const html = readFileSync(join(SITE_DIR, targetHtml), 'utf8');
	const forbiddenTerms = countForbiddenTerms(html, getForbiddenTermsForTarget(targetHtml));
	const isPrimary = targetHtml === 'index.html';
	return {
		target: targetHtml,
		mobileHeight,
		desktopHeight,
		forbiddenTerms,
		ctaVariants,
		thresholds: isPrimary ? THRESHOLDS : null,
		enforceThresholds: isPrimary,
	};
}

function collectViolations(allResults) {
	const violations = [];
	for (const r of allResults) {
		// 全ページ共通: 禁止語は 1 件でも検出すれば fail
		const forbidden = Object.entries(r.forbiddenTerms).filter(([, n]) => n > 0);
		if (forbidden.length > 0) {
			violations.push(
				`[${r.target}] forbiddenTerms: ${forbidden.map(([t, n]) => `${t}=${n}`).join(', ')}`,
			);
		}
		if (!r.enforceThresholds) continue;
		// index.html のみ height / ctaVariants 閾値を強制
		if (r.mobileHeight > THRESHOLDS.mobileHeight) {
			violations.push(`[${r.target}] mobileHeight=${r.mobileHeight} > ${THRESHOLDS.mobileHeight}`);
		}
		if (r.desktopHeight > THRESHOLDS.desktopHeight) {
			violations.push(
				`[${r.target}] desktopHeight=${r.desktopHeight} > ${THRESHOLDS.desktopHeight}`,
			);
		}
		if (r.ctaVariants.length > THRESHOLDS.ctaVariantsMax) {
			violations.push(
				`[${r.target}] ctaVariants=${r.ctaVariants.length} > ${THRESHOLDS.ctaVariantsMax} (${r.ctaVariants.map((c) => c.text).join(' | ')})`,
			);
		}
	}
	return violations;
}

async function main() {
	const { server, port } = await startStaticServer(SITE_DIR);
	log(`[measure] serving ${SITE_DIR} on http://127.0.0.1:${port}/`);

	const browser = await chromium.launch();
	const allResults = [];
	try {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		for (const targetHtml of TARGET_HTML_LIST) {
			allResults.push(await measureSingleTarget(page, port, targetHtml));
		}
	} finally {
		await browser.close();
		server.close();
	}

	// 後方互換: lp-metrics.json は index.html の結果（最初のターゲット）
	const single = allResults.find((r) => r.enforceThresholds) || allResults[0];
	const output = {
		timestamp: new Date().toISOString(),
		target: single.target,
		mobileHeight: single.mobileHeight,
		desktopHeight: single.desktopHeight,
		forbiddenTerms: single.forbiddenTerms,
		ctaVariants: single.ctaVariants,
		thresholds: THRESHOLDS,
		// #1637 R34: 全ターゲットの結果も併せて記録
		all: allResults,
	};
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
	log(JSON.stringify(output, null, 2));
	log(`[measure] saved -> ${OUTPUT_PATH}`);

	const violations = collectViolations(allResults);

	if (violations.length > 0) {
		logErr('\n[FAIL] LP metrics violations:');
		for (const v of violations) logErr(`  - ${v}`);
		process.exit(1);
	}
	log('\n[OK] all LP metrics within thresholds');
}

main().catch((err) => {
	logErr('[measure] error:', err);
	process.exit(1);
});
