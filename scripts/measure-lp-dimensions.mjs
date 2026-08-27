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
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/ci/screenshot-helpers.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

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
// #1848: graduation.html を追加（5 ステージ成長ロードマップの別ページ集約）
const TARGET_HTML_LIST = args.target
	? args.target.split(',')
	: ['index.html', 'pamphlet.html', 'pricing.html', 'faq.html', 'privacy.html', 'graduation.html'];

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
	// #1788: ADR-0013 LP truth + Permission marketing honesty 違反語彙
	//   実態は「親がセットアップで選択する 300+ 候補プール」。
	//   「プリセット済み」「セットアップ不要」「何もしなくても」は「自動的にそうなっている」誤認を生む。
	//   honest 表現例: 「習慣の候補が 300 件以上用意されています。セットアップで好きなものを選ぶだけ」
	'プリセット済み',
	'セットアップ不要',
	'何もしなくても',
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

// 法務文書 / LP に「個別のマネージドサービス名」を書かないための禁止語 (#4370)。
//
// 開示すべきは「データがどこへ出るか」= 事業者名 (Amazon Web Services, Inc. / Google LLC /
// Stripe, Inc.) と、運営者が管理する環境内か外部事業者かの区別であって、その内側でどの
// マネージドサービスを使っているかではない。個別サービス名を書くと実装を差し替えるたびに
// 法務文書が事実と乖離する (実例: DynamoDB は #3438 で撤去済なのに privacy.html に残存)。
//
// 事業者名 (AWS / Google LLC / Stripe) とリージョン (us-east-1) は個人情報保護法 §27 / §28 /
// 電気通信事業法 §27-12 の開示に必要なため禁止しない。
const MANAGED_SERVICE_FORBIDDEN_TERMS = [
	'DynamoDB',
	'Aurora',
	'DSQL',
	'Lambda',
	'CloudFront',
	'Cognito',
	'CloudWatch',
	'Bedrock',
	'Gemini',
	'Firehose',
	'PGlite',
	'SQLite',
	'Amazon S3',
	'Amazon SES',
];

// 後方互換: 既存テストや CI 参照用に統合配列も export 等価で残す
const FORBIDDEN_TERMS = [
	...IT_JARGON_FORBIDDEN_TERMS,
	...STRICT_FORBIDDEN_TERMS,
	...MANAGED_SERVICE_FORBIDDEN_TERMS,
];

// index.html のみ IT_JARGON も検証する。selfhost.html / privacy.html / faq.html / pamphlet.html /
// pricing.html では STRICT のみ検証。
function getForbiddenTermsForTarget(target) {
	if (target === 'index.html') {
		return FORBIDDEN_TERMS;
	}
	// #4370: マネージドサービス名は全ページ共通で禁止 (法務文書 privacy.html を含む)
	return [...STRICT_FORBIDDEN_TERMS, ...MANAGED_SERVICE_FORBIDDEN_TERMS];
}

// #4370: TARGET_HTML_LIST に含まれない site/ 配下の HTML (terms / sla / tokushoho / selfhost)
// と、LP 文言 SSOT の生成物 (shared-labels.js) も マネージドサービス名だけは走査する。
// 高さ計測 (browser) を伴わない静的テキスト検査なので全ファイルに掛けても安価。
const MANAGED_SERVICE_SCAN_EXTRA_FILES = [
	'terms.html',
	'sla.html',
	'tokushoho.html',
	'selfhost.html',
	'shared-labels.js',
];

function collectManagedServiceNameViolations() {
	const out = [];
	for (const file of MANAGED_SERVICE_SCAN_EXTRA_FILES) {
		const path = join(SITE_DIR, file);
		if (!existsSync(path)) continue;
		const content = readFileSync(path, 'utf8');
		const hits = Object.entries(
			countForbiddenTerms(content, MANAGED_SERVICE_FORBIDDEN_TERMS),
		).filter(([, n]) => n > 0);
		if (hits.length === 0) continue;
		out.push(
			`[site/${file}] managedServiceNames: ${hits.map(([t, n]) => `${t}=${n}`).join(', ')} ` +
				`(法務文書 / LP には事業者名と「運営者の環境内か外部か」を書き、個別サービス名は書かない — #4370)`,
		);
	}
	return out;
}

const THRESHOLDS = {
	// #1737 R18: ADR-0006 整合に復元 (2026-04-30)
	// silent ratchet 15000 → 15200 を、R3-A / R4 / R7 / R13 の縦伸び解消後に 15000 に戻す。
	// P5B2 bundle (#1720 R4 soft-features 4→3 圧縮) で実測 14700-14800 へ低下を確認後に restore。
	mobileHeight: 15000,
	desktopHeight: 8000,
	ctaVariantsMax: 3,
	// #1840: pre-merge 累積 desktopHeight gate のための warning 閾値。
	// fail 閾値 (8000) の 200px 手前に warning 帯を置き、PR で「次の数 PR で 8000 接触リスク」を
	// 早期通知する。ratchet (8000) は据え置き。warn-threshold は --warn-threshold で上書き可能。
	desktopHeightWarn: 7800,
	// #1803 / #4713: hero spec-badges 「120+ プリセット活動」CI 裏取り。
	// site/index.html `<li data-lp-key="heroSpecBadges.presetCount"><strong>120+</strong> プリセット活動</li>`
	// および site/shared-labels.js の「NNN+ のテンプレート」/「NNN 種類以上」表記が、実 marketplace data
	// に裏付けられているかを CI で assert する。実数 < 訴求値 になれば ADR-0013 LP truth 違反として fail。
	//
	// #4713: **裏取りの基準を「延べ件数」から「活動名のユニーク数」に変更した**。
	//   activity-packs は男の子 / 女の子 variant がほぼ同じ活動名を重複して持つため、延べ 325 件に対し
	//   ユニークな活動名は 129 種しかない。延べ数で「300+ プリセット活動」を裏取りすると、顧客が実際に
	//   選べる活動の種類を 2 倍以上に見せる訴求が CI 緑のまま通ってしまう。
	presetActivityCountClaimedMin: 120,
	// LP が訴求するセット (パック) 数の下限。実パック数がこれを下回れば LP 訴求が実装を上回る。
	presetActivityPackCountClaimedMin: 12,
};

// #1840: --warn-threshold=NNNN で上書き可能（CI 累積 gate での warning 帯調整用）
if (args['warn-threshold']) {
	const v = Number.parseInt(args['warn-threshold'], 10);
	if (Number.isFinite(v) && v > 0) {
		THRESHOLDS.desktopHeightWarn = v;
	}
}

const ACTIVITY_PACKS_DIR = resolve('src/lib/data/marketplace/activity-packs');

/**
 * src/lib/data/marketplace/activity-packs/*.json から activity 数を計算する。
 *
 * #1803 の AC (#4713 で基準を変更):
 *   - LP `heroSpecBadges.presetCount` (= '120+') が **活動名のユニーク数** で裏付けられているか
 *   - 実 marketplace data のユニーク数が訴求を下回った場合 LP 訴求と乖離 → ADR-0013 違反
 *
 * `total` (延べ) も返すが、裏取りに使うのは `unique`。男の子 / 女の子 variant が同じ活動名を
 * 重複して持つため、延べ数は顧客が選べる「種類」を過大に表す (#4713 実測: 延べ 325 / ユニーク 129)。
 */
function countActivityPackActivities() {
	if (!existsSync(ACTIVITY_PACKS_DIR))
		return { total: 0, unique: 0, breakdown: [], error: 'dir-not-found' };
	const files = readdirSync(ACTIVITY_PACKS_DIR).filter((f) => f.endsWith('.json'));
	let total = 0;
	const uniqueNames = new Set();
	const breakdown = [];
	for (const f of files) {
		try {
			const data = JSON.parse(readFileSync(join(ACTIVITY_PACKS_DIR, f), 'utf8'));
			const activities = Array.isArray(data?.payload?.activities) ? data.payload.activities : [];
			for (const a of activities) {
				if (typeof a?.name === 'string' && a.name !== '') uniqueNames.add(a.name);
			}
			breakdown.push({ pack: f, activities: activities.length });
			total += activities.length;
		} catch (e) {
			breakdown.push({ pack: f, activities: 0, error: e instanceof Error ? e.message : String(e) });
		}
	}
	return { total, unique: uniqueNames.size, breakdown, packCount: files.length };
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
		// 例: <li><strong data-lp-key="heroSpecBadges.presetCount">300+</strong>
		//       <span data-lp-key="heroSpecBadges.presetSuffix">プリセット活動 の候補</span></li>
		// #4626: hero バッジは値と後続語を別 data-lp-key で注入する形になったため、
		// <strong> の属性と間に挟まる 1 タグを許容する (訴求値と語句の隣接という assert 内容は不変)。
		const re = /<strong\b[^>]*>\s*(\d+)\+\s*<\/strong>\s*(?:<[^>]*>\s*)?プリセット活動/g;
		let m;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((m = re.exec(html)) !== null) {
			claims.push({ source: 'site/index.html', claimed: Number.parseInt(m[1], 10) });
		}
	}
	const sharedLabels = join(siteDir, 'shared-labels.js');
	if (existsSync(sharedLabels)) {
		const src = readFileSync(sharedLabels, 'utf8');
		// 例: "k96": "...120+ のテンプレートから..."
		const re = /(\d+)\+\s*の?\s*テンプレート/g;
		let m;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((m = re.exec(src)) !== null) {
			claims.push({ source: 'site/shared-labels.js', claimed: Number.parseInt(m[1], 10) });
		}
		// #4713: 「120 種類以上」形式 (PRESET_ACTIVITY_TERMS.uniqueCount) も裏取り対象にする。
		const reJa = /(\d+)\s*種類以上/g;
		let mJa;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
		while ((mJa = reJa.exec(src)) !== null) {
			claims.push({ source: 'site/shared-labels.js', claimed: Number.parseInt(mJa[1], 10) });
		}
	}
	return claims;
}

/**
 * site/shared-labels.js から「NN セット」表記 (PRESET_ACTIVITY_TERMS.packCount) を抽出する。
 * 実 activity-pack 数がこの訴求を下回っていないことを CI で assert するため (#4713)。
 *
 * 戻り値: { source, claimed }[] — claimed は数値 (例: 12)
 */
function extractClaimedPresetPackCount(siteDir) {
	const claims = [];
	const sharedLabels = join(siteDir, 'shared-labels.js');
	if (!existsSync(sharedLabels)) return claims;
	const src = readFileSync(sharedLabels, 'utf8');
	const re = /(\d+)\s*セット/g;
	let m;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
	while ((m = re.exec(src)) !== null) {
		claims.push({ source: 'site/shared-labels.js', claimed: Number.parseInt(m[1], 10) });
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

function collectForbiddenTermViolations(r) {
	const forbidden = Object.entries(r.forbiddenTerms).filter(([, n]) => n > 0);
	if (forbidden.length === 0) return null;
	return `[${r.target}] forbiddenTerms: ${forbidden.map(([t, n]) => `${t}=${n}`).join(', ')}`;
}

function collectMissingScreenshotViolations(r) {
	// #1783: 全ページ共通 — `<img src="screenshots/...">` 物理欠落は 1 件でも fail
	// （ADR-0029 / Issue #1783 — broken image を本番 LP に並べない）
	// 環境変数 SKIP_SCREENSHOT_EXISTENCE_CHECK=1 で skip 可能（ローカル開発 / Issue 検証時の段階確認用）
	if (process.env.SKIP_SCREENSHOT_EXISTENCE_CHECK === '1') return null;
	if (!Array.isArray(r.missingScreenshots) || r.missingScreenshots.length === 0) return null;
	return `[${r.target}] missingScreenshots (${r.missingScreenshots.length} 件): ${r.missingScreenshots.join(', ')}`;
}

function collectThresholdViolations(r) {
	// index.html のみ height / ctaVariants 閾値を強制
	const out = [];
	if (r.mobileHeight > THRESHOLDS.mobileHeight) {
		out.push(`[${r.target}] mobileHeight=${r.mobileHeight} > ${THRESHOLDS.mobileHeight}`);
	}
	if (r.desktopHeight > THRESHOLDS.desktopHeight) {
		out.push(`[${r.target}] desktopHeight=${r.desktopHeight} > ${THRESHOLDS.desktopHeight}`);
	}
	if (r.ctaVariants.length > THRESHOLDS.ctaVariantsMax) {
		out.push(
			`[${r.target}] ctaVariants=${r.ctaVariants.length} > ${THRESHOLDS.ctaVariantsMax} (${r.ctaVariants.map((c) => c.text).join(' | ')})`,
		);
	}
	return out;
}

/**
 * #1840: 累積 desktopHeight warning（fail ではない）を収集する。
 * fail 閾値 (THRESHOLDS.desktopHeight) を超えていない場合のみ、
 * warning 閾値 (THRESHOLDS.desktopHeightWarn) を超えているかを判定する。
 *
 * pre-merge cumulative gate (lp-metrics.yml の cumulative-lp-metrics ジョブ) で
 * 「累積で 8000 ratchet 接触リスク」を PR コメントに早期通知するために使用する。
 *
 * @param {object} r - measureSingleTarget の戻り値
 * @returns {string[]} warning メッセージ配列（空なら warning なし）
 */
function collectThresholdWarnings(r) {
	const out = [];
	if (!r.enforceThresholds) return out;
	// fail 域に達している場合は warning 不要（fail メッセージで十分）
	if (r.desktopHeight > THRESHOLDS.desktopHeight) return out;
	if (r.desktopHeight >= THRESHOLDS.desktopHeightWarn) {
		out.push(
			`[${r.target}] desktopHeight=${r.desktopHeight} ≧ warn-threshold ${THRESHOLDS.desktopHeightWarn} ` +
				`(fail 閾値 ${THRESHOLDS.desktopHeight} の ${THRESHOLDS.desktopHeight - r.desktopHeight}px 手前)`,
		);
	}
	return out;
}

function collectPresetViolations(presetCheck) {
	// #1803 / #4713: hero spec-badges presetCount 裏取り gate (基準 = 活動名のユニーク数)
	const out = [];
	const { uniqueCount, packCount, claims, packClaims } = presetCheck;
	for (const { source, claimed } of claims) {
		if (uniqueCount < claimed) {
			out.push(
				`[${source}] hero spec-badges presetCount: 訴求 ${claimed}+ ≦ 実 marketplace activity のユニーク名 ${uniqueCount} 種 を満たしていません ` +
					`(ADR-0013 LP truth 違反)`,
			);
		}
	}
	// #4713: 「12 セット」等のセット数訴求も同じ向き (訴求 ≦ 実数) で裏取りする
	for (const { source, claimed } of packClaims ?? []) {
		if (packCount < claimed) {
			out.push(
				`[${source}] preset セット数: 訴求 ${claimed} セット ≦ 実 activity-pack 数 ${packCount} を満たしていません ` +
					`(ADR-0013 LP truth 違反)`,
			);
		}
	}
	// 訴求 claim が 0 件でも、最低限 presetActivityCountClaimedMin は満たしているか確認
	// (LP に明示的訴求がない場合でも、内部 SSOT として下限を割らないかを ratchet 監視)
	if (uniqueCount < THRESHOLDS.presetActivityCountClaimedMin) {
		out.push(
			`[marketplace] activity-packs のユニーク活動名=${uniqueCount} < ${THRESHOLDS.presetActivityCountClaimedMin} ` +
				`(LP hero spec-badges 訴求の最低水準を割っています)`,
		);
	}
	if (packCount < THRESHOLDS.presetActivityPackCountClaimedMin) {
		out.push(
			`[marketplace] activity-pack 数=${packCount} < ${THRESHOLDS.presetActivityPackCountClaimedMin} ` +
				`(LP のセット数訴求の最低水準を割っています)`,
		);
	}
	return out;
}

/**
 * site/*.html の内部リンクのうち、フラグメント (`#id`) を持つものを全て解決し、
 * 「リンク先ファイルが無い」「リンク先に該当 id が無い」を違反として返す (#4714)。
 *
 * なぜ必要か:
 *   LP は静的 HTML なので、id を消しても改名してもリンク側は 200 を返し続け、顧客は
 *   「詳しくはこちら」を押してページ先頭に着地する。実測 (#4714) で 4 本が死んでいた
 *   (`faq.html#baby-mode` / `pricing.html#family-patterns` / `index.html#features` ×2)。
 *   HTTP の到達性検査では捕まらないため、id の実在まで含めて機械検証する。
 *
 * 対象は site/ 直下の全 HTML (TARGET_HTML_LIST に限定しない — 法務ページの nav も対象)。
 */
function collectDeadAnchorViolations() {
	if (!existsSync(SITE_DIR)) return [];
	const htmlFiles = readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'));
	/** @type {Record<string, Set<string>>} */
	const idsByFile = {};
	/** @type {Record<string, string>} */
	const srcByFile = {};
	for (const f of htmlFiles) {
		const src = readFileSync(join(SITE_DIR, f), 'utf8');
		srcByFile[f] = src;
		idsByFile[f] = new Set([...src.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]));
	}
	const out = [];
	for (const f of htmlFiles) {
		for (const m of srcByFile[f].matchAll(/href=["']([^"']+)["']/g)) {
			const href = m[1];
			if (/^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
			const hashIdx = href.indexOf('#');
			if (hashIdx === -1) continue;
			const fragment = href.slice(hashIdx + 1);
			if (fragment === '') continue; // `#` 単体 (先頭へ戻る) は対象外
			const targetFile = hashIdx === 0 ? f : href.slice(0, hashIdx);
			if (!idsByFile[targetFile]) {
				out.push(
					`[site/${f}] dead anchor: ${href} — リンク先 site/${targetFile} が存在しません (#4714)`,
				);
				continue;
			}
			if (!idsByFile[targetFile].has(fragment)) {
				out.push(
					`[site/${f}] dead anchor: ${href} — site/${targetFile} に id="${fragment}" がありません ` +
						`(顧客はページ先頭に着地します。id を付けるかリンク先を実在する id に変える、#4714)`,
				);
			}
		}
	}
	return out;
}

function collectViolations(allResults, presetCheck) {
	const violations = [];
	violations.push(...collectDeadAnchorViolations());
	for (const r of allResults) {
		// 全ページ共通: 禁止語は 1 件でも検出すれば fail
		const forbidden = collectForbiddenTermViolations(r);
		if (forbidden) violations.push(forbidden);
		const missing = collectMissingScreenshotViolations(r);
		if (missing) violations.push(missing);
		if (!r.enforceThresholds) continue;
		violations.push(...collectThresholdViolations(r));
	}
	violations.push(...collectManagedServiceNameViolations());
	if (presetCheck) {
		violations.push(...collectPresetViolations(presetCheck));
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
	const packClaims = extractClaimedPresetPackCount(SITE_DIR);
	const presetCheck = {
		// 後方互換: 延べ件数も出力する (裏取りに使うのは #4713 以降 uniqueCount)
		actualCount: packCount.total,
		uniqueCount: packCount.unique,
		claims,
		packClaims,
		breakdown: packCount.breakdown,
		packCount: packCount.packCount,
	};

	// #1840: warning（fail ではない）も収集して JSON / stdout に出力する
	const warnings = [];
	for (const r of allResults) {
		warnings.push(...collectThresholdWarnings(r));
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
		// #1783: 物理欠落 LP screenshot を CI で可視化する
		screenshotRefs: single.screenshotRefs ?? [],
		missingScreenshots: single.missingScreenshots ?? [],
		thresholds: THRESHOLDS,
		// #1840: 累積 gate 用の warning（fail に至らないが ratchet 接触リスク域）
		warnings,
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
	// #1840: warning は fail させずに stderr へ出力する（CI 側で PR コメント等に活用）
	if (warnings.length > 0) {
		logErr('\n[WARN] LP metrics warnings (cumulative ratchet 接触リスク):');
		for (const w of warnings) logErr(`  - ${w}`);
	}
	log('\n[OK] all LP metrics within thresholds');
}

// CLI として直接実行されたときのみ main() を起動 (#1783: テストで import しても副作用を出さない)
if (isMainModule(import.meta.url)) {
	main().catch((err) => {
		logErr('[measure] error:', err);
		process.exit(1);
	});
}
