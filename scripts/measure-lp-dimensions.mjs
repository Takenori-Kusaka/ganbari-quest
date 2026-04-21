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
const TARGET_HTML = args.target || 'index.html';

// #1088 / #1163 の禁止語（開発者向け語彙を LP に残さない）
// #1212-H / ADR-0041: 「マーケットプレイス」「マケプレ」→「みんなのテンプレート」「テンプレート」へ移行済。再混入を CI 検出
// #1286: 安心訴求セクションで「OSS / ソースコード / サーバー / 自前運用」を追加禁止（IT 非リテラシ親への伝達性を優先）。
//   例外: これらを本当に書きたいページ（selfhost.html 等）は TARGET_HTML として scan しないため影響なし
const FORBIDDEN_TERMS = [
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

const THRESHOLDS = {
	mobileHeight: 15000,
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

function countForbiddenTerms(html) {
	const counts = {};
	for (const term of FORBIDDEN_TERMS) {
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

async function main() {
	const { server, port } = await startStaticServer(SITE_DIR);
	const url = `http://127.0.0.1:${port}/${TARGET_HTML}`;
	log(`[measure] serving ${SITE_DIR} on ${url}`);

	const browser = await chromium.launch();
	let result;
	try {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();

		const mobileHeight = await measureHeight(page, url, 375);
		const ctaVariants = await extractCtaVariants(page);

		const desktopHeight = await measureHeight(page, url, 1280);

		const html = readFileSync(join(SITE_DIR, TARGET_HTML), 'utf8');
		const forbiddenTerms = countForbiddenTerms(html);

		result = {
			timestamp: new Date().toISOString(),
			target: TARGET_HTML,
			mobileHeight,
			desktopHeight,
			forbiddenTerms,
			ctaVariants,
			thresholds: THRESHOLDS,
		};
	} finally {
		await browser.close();
		server.close();
	}

	writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
	log(JSON.stringify(result, null, 2));
	log(`[measure] saved -> ${OUTPUT_PATH}`);

	const violations = [];
	if (result.mobileHeight > THRESHOLDS.mobileHeight) {
		violations.push(`mobileHeight=${result.mobileHeight} > ${THRESHOLDS.mobileHeight}`);
	}
	if (result.desktopHeight > THRESHOLDS.desktopHeight) {
		violations.push(`desktopHeight=${result.desktopHeight} > ${THRESHOLDS.desktopHeight}`);
	}
	const forbidden = Object.entries(result.forbiddenTerms).filter(([, n]) => n > 0);
	if (forbidden.length > 0) {
		violations.push(`forbiddenTerms: ${forbidden.map(([t, n]) => `${t}=${n}`).join(', ')}`);
	}
	if (result.ctaVariants.length > THRESHOLDS.ctaVariantsMax) {
		violations.push(
			`ctaVariants=${result.ctaVariants.length} > ${THRESHOLDS.ctaVariantsMax} (${result.ctaVariants.map((c) => c.text).join(' | ')})`,
		);
	}

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
