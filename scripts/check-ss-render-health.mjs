#!/usr/bin/env node

/**
 * scripts/check-ss-render-health.mjs (#3012)
 *
 * screenshots branch に push された PR SS の **render 健全性** (500 / error ページ混入) を
 * 検証する CI gate (補完層)。
 *
 * # 設計背景
 *
 * PR #3006 で /admin/rewards・/admin/checklists の 500 サーバーエラーページが
 * 「実画面 SS」として screenshots branch (`pr-3006/`) に 2 度 push され、既存 CI gate
 * (`ss-blob-sha-uniqueness-check` #2063 / `screenshot-quality-check` #1740/#1741) を
 * green で素通りした。既存 gate は「偽装 (同一画像)」「ローカルパス」を見るが、
 * 「SS が正常画面か」は誰も見ていなかった。
 *
 * # 2 層防御における位置付け
 *
 * - 根本層 (撮影時 assert): `scripts/lib/screenshot-helpers.mjs` `checkRenderHealth`
 *   — capture.mjs / capture-app-baseline.mjs が撮影直前に error ページを検出して exit 1。
 *   error ページ SS はそもそも生成・push されない。
 * - 補完層 (本 script): 旧版 capture script の使用 / 手動 push 等で撮影時 assert を
 *   バイパスされた場合に備え、screenshots branch `pr-<N>/` の `.dom.html`
 *   (SS と同一 page から取得される DOM snapshot、#1766) を text scan して
 *   error ページ marker を検出する。画像解析 (OCR / pixelmatch) は行わない
 *   (Pre-PMF 軽量方針、ADR-0010 — marker 定義は撮影時 assert と同一 SSOT
 *   `detectErrorMarkersInHtml` を共有 #1442)。
 *
 * 加えて、画像 (png/webp/jpeg) が push されているのに対応する `.dom.html` が
 * 存在しないものは **warning として列挙** する (#3006 の実事故 push `744dc5c3a` は
 * dom.html なしの PNG のみ = capture.mjs 正規経路をバイパスした手動 push であり、
 * dom scan では検出不能なため、QM レビュー時の手掛かりとして可視化する)。
 * legit な欠落ケース (before-* rename 運用 / --no-dom-snapshot / *-flow.webp 合成) が
 * あるため hard-fail にはしない。
 *
 * # スキップ条件
 *
 * - PR ラベル `refactor:internal-no-doc-impact` (SS 不要 refactor、#2017 と同パターン)
 * - PR ラベル `ss:error-page-intended` (エラーページ自体のデザイン変更 PR で
 *   error ページ SS の添付が正当な場合。capture.mjs --allow-error-page と対)
 * - screenshots branch に `pr-<N>/` が存在しない / `.dom.html` が 0 件
 *
 * # 環境変数
 *
 *   PR_NUMBER         — PR 番号 (github.event.pull_request.number)
 *   PR_LABELS         — カンマ区切りの PR ラベル
 *   GH_TOKEN          — GitHub API token
 *   GITHUB_REPOSITORY — `owner/repo`
 *   CHECK_MODE        — 'warn' | 'error' (default: 'error'。error ページ混入は顧客提示物の
 *                       毀損で致命的なため #2063 と同様 warn 段階を経ず hard-fail)
 *
 * # ローカル実行
 *
 *   PR_NUMBER=3006 GITHUB_REPOSITORY=Takenori-Kusaka/ganbari-quest \
 *   CHECK_MODE=error node scripts/check-ss-render-health.mjs
 *
 * # exit code
 *
 *   0 — OK / skip / warn モードで違反あり
 *   1 — error モードで違反あり
 *   2 — internal error (API 失敗等)
 */

import { resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectErrorMarkersInHtml } from './lib/screenshot-helpers.mjs';

const MODE = (process.env.CHECK_MODE || 'error').toLowerCase();
const PR_NUMBER = process.env.PR_NUMBER || '';
const REPO = process.env.GITHUB_REPOSITORY || '';
const PR_LABELS = (process.env.PR_LABELS || '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// ---------------------------------------------------------------------------
// Pure functions (named exports for vitest)
// ---------------------------------------------------------------------------

/** #2017 / #1985 / #2063 共通の内部 refactor exempt ラベル */
export const INTERNAL_REFACTOR_LABEL = 'refactor:internal-no-doc-impact';

/**
 * エラーページ自体のデザイン変更 PR 用 exempt ラベル (#3012)。
 * capture.mjs `--allow-error-page` (撮影時 assert の opt-out) と対になる CI 側 opt-out。
 */
export const ERROR_PAGE_INTENDED_LABEL = 'ss:error-page-intended';

/**
 * exempt ラベル判定。
 * @param {string[]} labels
 * @returns {{ exempt: boolean; label?: string }}
 */
export function findExemptLabel(labels) {
	for (const candidate of [INTERNAL_REFACTOR_LABEL, ERROR_PAGE_INTENDED_LABEL]) {
		if (labels.some((l) => l.trim().toLowerCase() === candidate)) {
			return { exempt: true, label: candidate };
		}
	}
	return { exempt: false };
}

/**
 * `.dom.html` ファイル群を scan して error ページ marker 違反を検出する。
 *
 * @param {Array<{ name: string; html: string }>} files
 * @returns {Array<{ name: string; reasons: string[] }>}
 */
export function judgeDomSnapshots(files) {
	const violations = [];
	for (const f of files) {
		const reasons = detectErrorMarkersInHtml(f.html);
		if (reasons.length > 0) {
			violations.push({ name: f.name, reasons });
		}
	}
	return violations;
}

/**
 * 画像ファイル名一覧のうち、対応する `.dom.html` (同 basename) が存在しないものを返す。
 *
 * 除外 (legit な dom なしケース):
 *   - `*-flow.webp` (FlowRecorder のグリッド合成、DOM snapshot 対象外)
 *
 * @param {string[]} imageNames - 画像ファイル名 (png/webp/jpeg)
 * @param {string[]} domNames - `.dom.html` ファイル名
 * @returns {string[]} dom pair 欠落の画像ファイル名
 */
export function findImagesMissingDomPair(imageNames, domNames) {
	const domBases = new Set(domNames.map((n) => n.replace(/\.dom\.html$/, '')));
	return imageNames.filter((name) => {
		if (/-flow\.webp$/i.test(name)) return false;
		const base = name.replace(/\.(png|jpe?g|webp|gif)$/i, '');
		return !domBases.has(base);
	});
}

/**
 * screenshots branch の `pr-<N>/` 配下のファイル一覧を取得し、`.dom.html` の中身を fetch する。
 *
 * @param {{ repo: string; prNumber: string | number; fetcher?: typeof fetch }} input
 * @returns {Promise<{ domFiles: Array<{ name: string; html: string }>; imageNames: string[] } | null>}
 *   dir 不在なら null
 */
export async function fetchPrScreenshotEntries({ repo, prNumber, fetcher = fetch }) {
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	if (token) headers.Authorization = `Bearer ${token}`;

	const listUrl = `https://api.github.com/repos/${repo}/contents/pr-${prNumber}?ref=screenshots`;
	const listRes = await fetcher(listUrl, { headers });
	if (listRes.status === 404) return null;
	if (!listRes.ok) {
		throw new Error(`GitHub API failed for pr-${prNumber} listing: ${listRes.status}`);
	}
	const entries = await listRes.json();
	if (!Array.isArray(entries)) return null;

	const fileNames = entries
		.filter((e) => e.type === 'file' && typeof e.name === 'string')
		.map((e) => e.name);
	const imageNames = fileNames.filter((n) => /\.(png|jpe?g|webp|gif)$/i.test(n));

	const domEntries = entries.filter(
		(e) => e.type === 'file' && typeof e.name === 'string' && e.name.endsWith('.dom.html'),
	);

	const domFiles = [];
	for (const entry of domEntries) {
		if (!entry.download_url) continue;
		const res = await fetcher(entry.download_url, { headers });
		if (!res.ok) {
			throw new Error(`GitHub raw fetch failed for ${entry.name}: ${res.status}`);
		}
		domFiles.push({ name: entry.name, html: await res.text() });
	}
	return { domFiles, imageNames };
}

/**
 * 本体処理。fetcher を DI 可能にして test で mock 注入する。
 *
 * @param {{ repo: string; prNumber: string; labels: string[]; fetcher?: typeof fetch }} input
 * @returns {Promise<{ status: 'pass' | 'fail' | 'skip'; reason: string; violations?: Array<{ name: string; reasons: string[] }>; missingDomPairs?: string[] }>}
 */
export async function checkSsRenderHealth({ repo, prNumber, labels, fetcher = fetch }) {
	const exempt = findExemptLabel(labels);
	if (exempt.exempt) {
		return {
			status: 'skip',
			reason: `PR ラベル '${exempt.label}' により exempt (#3012)`,
		};
	}
	if (!prNumber) {
		return { status: 'skip', reason: 'PR_NUMBER 未指定 (PR コンテキスト外)' };
	}
	if (!repo) {
		return { status: 'skip', reason: 'GITHUB_REPOSITORY 未指定' };
	}

	const entries = await fetchPrScreenshotEntries({ repo, prNumber, fetcher });
	if (entries === null) {
		return {
			status: 'skip',
			reason: `screenshots branch に pr-${prNumber}/ が存在しません (SS 未 push)`,
		};
	}
	const { domFiles, imageNames } = entries;

	// #3006 実事故 (744dc5c3a) パターンの可視化: dom.html なし画像 = capture.mjs 正規経路
	// バイパスの疑い。legit ケースがあるため warn のみ (hard-fail しない)。
	const missingDomPairs = findImagesMissingDomPair(
		imageNames,
		domFiles.map((f) => f.name),
	);

	if (domFiles.length === 0) {
		return {
			status: 'skip',
			reason: `pr-${prNumber}/ に .dom.html が 0 件 (撮影時 assert #3012 と QM 目視が担保)`,
			missingDomPairs,
		};
	}

	const violations = judgeDomSnapshots(domFiles);
	if (violations.length === 0) {
		return {
			status: 'pass',
			reason: `${domFiles.length} 件の .dom.html すべてで error ページ marker なし`,
			missingDomPairs,
		};
	}
	return {
		status: 'fail',
		reason: `${violations.length}/${domFiles.length} 件の SS が error ページを描画 (混入疑い)`,
		violations,
		missingDomPairs,
	};
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

async function main() {
	const isError = MODE === 'error';
	const prefix = '[ss-render-health]';

	let result;
	try {
		result = await checkSsRenderHealth({ repo: REPO, prNumber: PR_NUMBER, labels: PR_LABELS });
	} catch (err) {
		console.error(`${prefix} internal error:`, err.message);
		return 2;
	}

	// #3006 (744dc5c3a) パターン: dom.html を伴わない画像 push の warning (non-blocking)
	if (result.missingDomPairs && result.missingDomPairs.length > 0) {
		console.log(
			`${prefix} WARN — ${result.missingDomPairs.length} 件の画像に対応する .dom.html がありません ` +
				'(capture.mjs 正規経路バイパスの疑い。QM は SS 実視認時に注意):',
		);
		for (const name of result.missingDomPairs) {
			console.log(`  - pr-${PR_NUMBER}/${name}`);
		}
	}

	if (result.status === 'skip') {
		console.log(`${prefix} SKIP — ${result.reason}`);
		return 0;
	}
	if (result.status === 'pass') {
		console.log(`${prefix} OK — ${result.reason}`);
		return 0;
	}

	// fail
	console.log(`\n${prefix} ${isError ? 'ERROR' : 'WARN'} — ${result.reason}`);
	console.log('\nerror ページ marker が検出された SS:');
	for (const v of result.violations) {
		console.log(`  - pr-${PR_NUMBER}/${v.name}`);
		for (const r of v.reasons) {
			console.log(`      ${r}`);
		}
	}
	console.log(
		[
			'',
			'背景: PR #3006 で 500 エラーページが「実画面 SS」として screenshots branch に',
			'2 度 push され、QM の手動目視でのみ検出された (#3012)。',
			'',
			'対応方法:',
			'  1. 対象ページが 500 / 404 を返す原因を修正する',
			'  2. node scripts/capture.mjs --pr <N> で SS を撮り直す (撮影時 assert #3012 が再発を防ぐ)',
			'  3. エラーページ自体のデザイン SS が正当な場合のみ PR ラベル',
			`     '${ERROR_PAGE_INTENDED_LABEL}' を付与して re-run する`,
			'',
			`mode=${MODE}, violations=${result.violations.length} ` +
				`(${isError ? 'CI を red にします' : 'warning として記録、CI は通過させます'})`,
		].join('\n'),
	);

	return isError ? 1 : 0;
}

const isMain = (() => {
	try {
		return pathResolve(fileURLToPath(import.meta.url)) === pathResolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	main().then(
		(code) => process.exit(code),
		(err) => {
			console.error('[ss-render-health] uncaught:', err);
			process.exit(2);
		},
	);
}
