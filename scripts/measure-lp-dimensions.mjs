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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
	// #1708 R3-A: kind=routine 廃止に伴い「ルーティンチェックリスト」語彙を LP / 設計書から完全排除
	// （持ち物 = event-* プリセット / 毎日 must = 活動マスタ priority 属性 で責務分離）
	'ルーティンチェックリスト',
	// #1782: ADR-0012 §6 整合 + #404 廃止合意の revert 復活への対応。
	//   「実績 & 称号」機能は廃止（チャレンジ機能 /admin/challenges に統合）。
	//   再混入を CI 自動検出するため LP / faq / pricing / pamphlet で禁止語彙化。
	//   注: 「称号」単体は `levelTitleSectionTitle` 等のレベル称号システムで実装中であり、
	//   「称号」「実績」を機能 SSOT 訴求として復活させる文脈（カード見出し / コレクション） のみ禁止。
	'実績解放',
	'実績 & 称号',
	'実績 &amp; 称号',
	'称号コレクション',
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
	// #1737 R18: ADR-0006 整合に復元 (2026-04-30)
	// silent ratchet 15000 → 15200 を、R3-A / R4 / R7 / R13 の縦伸び解消後に 15000 に戻す。
	// P5B2 bundle (#1720 R4 soft-features 4→3 圧縮) で実測 14700-14800 へ低下を確認後に restore。
	mobileHeight: 15000,
	desktopHeight: 8000,
	ctaVariantsMax: 3,
	// #1803: hero spec-badges 「300+ プリセット活動」CI 裏取り。
	// site/index.html L480 `<li data-lp-key="heroSpecBadges.presetCount"><strong>300+</strong> プリセット活動</li>`
	// および site/shared-labels.js k96「300+ のテンプレート」が、実 marketplace data
	// (src/lib/data/marketplace/activity-packs/*.json の payload.activities 合計) に裏付けられているかを
	// CI で assert する。実数 < 訴求値 になれば ADR-0013 LP truth 違反として fail。
	presetActivityCountClaimedMin: 300,
};

const ACTIVITY_PACKS_DIR = resolve('src/lib/data/marketplace/activity-packs');

/**
 * src/lib/data/marketplace/activity-packs/*.json から activity 総数を計算する。
 * 各 pack の payload.activities[] の数を合算した値を返す。
 *
 * #1803 の AC:
 *   - LP `heroSpecBadges.presetCount` (= '300+') が実 marketplace count >= 300 で裏付けられているか
 *   - 実 marketplace data が 300 件以下になった場合 LP 訴求と乖離 → ADR-0013 違反
 */
function countActivityPackActivities() {
	if (!existsSync(ACTIVITY_PACKS_DIR)) return { total: 0, breakdown: [], error: 'dir-not-found' };
	const files = readdirSync(ACTIVITY_PACKS_DIR).filter((f) => f.endsWith('.json'));
	let total = 0;
	const breakdown = [];
	for (const f of files) {
		try {
			const data = JSON.parse(readFileSync(join(ACTIVITY_PACKS_DIR, f), 'utf8'));
			const n = Array.isArray(data?.payload?.activities) ? data.payload.activities.length : 0;
			breakdown.push({ pack: f, activities: n });
			total += n;
		} catch (e) {
			breakdown.push({ pack: f, activities: 0, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return { total, breakdown, packCount: files.length };
}

/**
 * site/index.html / site/shared-labels.js から `<strong>NNN+</strong> プリセット活動` /
 * 「NNN+ のテンプレート」表記の数値部分を抽出する。
 *
 * 戻り値: { source, claimed }[] — claimed は数値 (例: 300)
 */
function extractClaimedPresetCount(siteDir) {
	const claims = [];
	const indexHtml = join(siteDir, 'index.html');
	if (existsSync(indexHtml)) {
		const html = readFileSync(indexHtml, 'utf8');
		// 例: <li data-lp-key="heroSpecBadges.presetCount"><strong>300+</strong> プリセット活動</li>
		const re = /<strong>\s*(\d+)\+\s*<\/strong>\s*プリセット活動/g;
		let m;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((m = re.exec(html)) !== null) {
			claims.push({ source: 'site/index.html', claimed: Number.parseInt(m[1], 10) });
		}
	}
	const sharedLabels = join(siteDir, 'shared-labels.js');
	if (existsSync(sharedLabels)) {
		const src = readFileSync(sharedLabels, 'utf8');
		// 例: "k96": "...300+ のテンプレートから..."
		const re = /(\d+)\+\s*の?\s*テンプレート/g;
		let m;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((m = re.exec(src)) !== null) {
			claims.push({ source: 'site/shared-labels.js', claimed: Number.parseInt(m[1], 10) });
		}
	}
	return claims;
}

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

/**
 * LP HTML 内で参照している `screenshots/...` 画像の物理存在を検証する (#1783)。
 *
 * `<img src="screenshots/foo.webp">` および `<source srcset="screenshots/foo-desktop.webp">`
 * を抽出し、`site/screenshots/` ディレクトリに実体ファイルが存在するか確認する。
 *
 * 1 件でも欠落している場合は CI を fail させる（ADR-0029 / #1783 — broken image を black-out しない）。
 *
 * @param {string} html - LP HTML 文字列
 * @param {string} siteDir - site ルートディレクトリ絶対パス
 * @returns {{ referenced: string[]; missing: string[] }}
 */
export function findMissingScreenshots(html, siteDir) {
	const referenced = new Set();
	// img src="screenshots/..."
	const imgSrcRe = /\b(?:src|srcset)\s*=\s*["']([^"']*screenshots\/[^"']+)["']/g;
	let m;
	// biome-ignore lint/suspicious/noAssignInExpressions: 標準 regex iteration pattern
	while ((m = imgSrcRe.exec(html)) !== null) {
		// srcset は "url 2x, url2 1x" 形式があり得るが LP では単一 URL の運用 (#1783)
		const candidate = m[1].split(/\s+/)[0];
		if (candidate.includes('screenshots/')) {
			// site/foo or screenshots/foo の両形式に対応
			const rel = candidate.replace(/^.*?screenshots\//, 'screenshots/');
			referenced.add(rel);
		}
	}
	const referencedList = [...referenced].sort();
	const missing = referencedList.filter((rel) => !existsSync(join(siteDir, rel)));
	return { referenced: referencedList, missing };
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
			// #1732: floating-cta は単一機能ユニットの中で深度別に文言切替する設計のため、
			// ratchet 集計から除外する（lp-content-map.md §7.4）。
			// data-floating-cta="container" を持つ祖先要素配下の anchor は集計しない。
			if (el.closest?.('[data-floating-cta]')) continue;
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
	// #1783: LP HTML が参照する screenshots/*.webp の物理存在を検証する。
	// CI 環境では Pages workflow が直前に撮影しているはずなので、欠落 = 撮影失敗の検知になる。
	const { referenced: screenshotRefs, missing: missingScreenshots } = findMissingScreenshots(
		html,
		SITE_DIR,
	);
	const isPrimary = targetHtml === 'index.html';
	return {
		target: targetHtml,
		mobileHeight,
		desktopHeight,
		forbiddenTerms,
		ctaVariants,
		screenshotRefs,
		missingScreenshots,
		thresholds: isPrimary ? THRESHOLDS : null,
		enforceThresholds: isPrimary,
	};
}

/**
 * #1783 follow-up: browser launch なしで forbidden terms / missing screenshots だけを検証する。
 *
 * unit test (CI で chromium 不在) 用の軽量経路。`MEASURE_SKIP_BROWSER=1` で起動。
 * height / ctaVariants は計測されず 0 / [] になる（index.html の height ratchet 等は
 * playwright 必須の lp-metrics.yml job 側で担保する）。
 *
 * @param {string} targetHtml
 * @returns {object}
 */
function measureSingleTargetWithoutBrowser(targetHtml) {
	log(`[measure] target (no-browser): ${targetHtml}`);
	const html = readFileSync(join(SITE_DIR, targetHtml), 'utf8');
	const forbiddenTerms = countForbiddenTerms(html, getForbiddenTermsForTarget(targetHtml));
	const { referenced: screenshotRefs, missing: missingScreenshots } = findMissingScreenshots(
		html,
		SITE_DIR,
	);
	const isPrimary = targetHtml === 'index.html';
	return {
		target: targetHtml,
		mobileHeight: 0,
		desktopHeight: 0,
		forbiddenTerms,
		ctaVariants: [],
		screenshotRefs,
		missingScreenshots,
		thresholds: isPrimary ? THRESHOLDS : null,
		// no-browser モードでは height / cta 閾値は適用しない（測定値が偽の 0 のため）
		// missing screenshots / forbidden terms はそれぞれの評価ロジックで検証される
		enforceThresholds: false,
	};
}

function collectViolations(allResults, presetCheck) {
	const violations = [];
	for (const r of allResults) {
		// 全ページ共通: 禁止語は 1 件でも検出すれば fail
		const forbidden = Object.entries(r.forbiddenTerms).filter(([, n]) => n > 0);
		if (forbidden.length > 0) {
			violations.push(
				`[${r.target}] forbiddenTerms: ${forbidden.map(([t, n]) => `${t}=${n}`).join(', ')}`,
			);
		}
		// #1783: 全ページ共通 — `<img src="screenshots/...">` 物理欠落は 1 件でも fail
		// （ADR-0029 / Issue #1783 — broken image を本番 LP に並べない）
		// 環境変数 SKIP_SCREENSHOT_EXISTENCE_CHECK=1 で skip 可能（ローカル開発 / Issue 検証時の段階確認用）
		if (
			Array.isArray(r.missingScreenshots) &&
			r.missingScreenshots.length > 0 &&
			process.env.SKIP_SCREENSHOT_EXISTENCE_CHECK !== '1'
		) {
			violations.push(
				`[${r.target}] missingScreenshots (${r.missingScreenshots.length} 件): ${r.missingScreenshots.join(', ')}`,
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

	// #1803: hero spec-badges presetCount 裏取り gate
	if (presetCheck) {
		const { actualCount, claims } = presetCheck;
		for (const { source, claimed } of claims) {
			if (actualCount < claimed) {
				violations.push(
					`[${source}] hero spec-badges presetCount: 訴求 ${claimed}+ ≦ 実 marketplace activity 数 ${actualCount} を満たしていません ` +
						`(ADR-0013 LP truth 違反)`,
				);
			}
		}
		// 訴求 claim が 0 件でも、最低限 presetActivityCountClaimedMin は満たしているか確認
		// (LP に明示的訴求がない場合でも、内部 SSOT として 300 を割らないかを ratchet 監視)
		if (actualCount < THRESHOLDS.presetActivityCountClaimedMin) {
			violations.push(
				`[marketplace] activity-packs activities=${actualCount} < ${THRESHOLDS.presetActivityCountClaimedMin} ` +
					`(LP hero spec-badges 訴求の最低水準を割っています)`,
			);
		}
	}
	return violations;
}

async function main() {
	const allResults = [];
	// #1783 follow-up: MEASURE_SKIP_BROWSER=1 でブラウザ launch を skip し、
	// forbidden terms / missing screenshots gate のみを検証する軽量経路。
	// CI で chromium が install されていない unit test 環境用。
	if (process.env.MEASURE_SKIP_BROWSER === '1') {
		log('[measure] MEASURE_SKIP_BROWSER=1 — skipping browser launch (height/cta not measured)');
		for (const targetHtml of TARGET_HTML_LIST) {
			if (!existsSync(join(SITE_DIR, targetHtml))) {
				log(`[measure] skip: ${targetHtml} (file not found in site dir)`);
				continue;
			}
			allResults.push(measureSingleTargetWithoutBrowser(targetHtml));
		}
	} else {
		const { server, port } = await startStaticServer(SITE_DIR);
		log(`[measure] serving ${SITE_DIR} on http://127.0.0.1:${port}/`);

		const browser = await chromium.launch();
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
	}

	// #1803: marketplace 実 activity 数 + LP 訴求 claim を計算
	const packCount = countActivityPackActivities();
	const claims = extractClaimedPresetCount(SITE_DIR);
	const presetCheck = {
		actualCount: packCount.total,
		claims,
		breakdown: packCount.breakdown,
		packCount: packCount.packCount,
	};

	// 後方互換: lp-metrics.json は index.html の結果（最初のターゲット）
	const single = allResults.find((r) => r.enforceThresholds) || allResults[0];
	const output = {
		timestamp: new Date().toISOString(),
		target: single.target,
		mobileHeight: single.mobileHeight,
		desktopHeight: single.desktopHeight,
		forbiddenTerms: single.forbiddenTerms,
		ctaVariants: single.ctaVariants,
		// #1783: 物理欠落 LP screenshot を CI で可視化する
		screenshotRefs: single.screenshotRefs ?? [],
		missingScreenshots: single.missingScreenshots ?? [],
		thresholds: THRESHOLDS,
		// #1637 R34: 全ターゲットの結果も併せて記録
		all: allResults,
		// #1803: hero spec-badges 裏取り
		presetCheck,
	};
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
	log(JSON.stringify(output, null, 2));
	log(`[measure] saved -> ${OUTPUT_PATH}`);

	const violations = collectViolations(allResults, presetCheck);

	if (violations.length > 0) {
		logErr('\n[FAIL] LP metrics violations:');
		for (const v of violations) logErr(`  - ${v}`);
		process.exit(1);
	}
	log('\n[OK] all LP metrics within thresholds');
}

// CLI として直接実行されたときのみ main() を起動 (#1783: テストで import しても副作用を出さない)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((err) => {
		logErr('[measure] error:', err);
		process.exit(1);
	});
}
