#!/usr/bin/env node
/**
 * scripts/check-orphan-routes.mjs (EPIC #2362 follow-up)
 *
 * src/routes/ 配下の page route について、`href` / `goto()` で参照されておらず
 * かつ `legacy-url-map.ts` に redirect 定義もないものを検出する。
 *
 * 構造的予防の目的:
 *   - 機能撤去後に route だけ残り、UI からの導線が完全に切れた dead page を可視化
 *   - リンク切れ常態化の予防
 *
 * 使用法:
 *   node scripts/check-orphan-routes.mjs              # CI mode
 *   node scripts/check-orphan-routes.mjs --report     # 詳細 report
 *   node scripts/check-orphan-routes.mjs --update-baseline
 *
 * baseline: scripts/orphan-baselines/routes.json
 *
 * 検出ロジック:
 *   1. src/routes/ 配下の +page.svelte を walk
 *   2. ファイルパスから URL path に変換 (groups `(...)` 除去、`[param]` は wildcard 化)
 *   3. 各 URL path について src/ + site/ + scripts/ 全体から
 *      `href="<path>` / `goto('<path>` / `redirect(..., '<path>')` を grep
 *   4. legacy-url-map.ts に redirect 定義があれば許容
 *   5. API route (/api/*) と root + 認証 path は対象外
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	loadBaseline,
	parseArgs,
	REPO_ROOT,
	reportFindings,
	walkDir,
} from './lib/orphan-utils.mjs';

const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'routes');
const LEGACY_URL_MAP = path.join(REPO_ROOT, 'src', 'lib', 'server', 'routing', 'legacy-url-map.ts');
const SEARCH_DIRS = ['src', 'site', 'scripts', 'tests'];
const SEARCH_EXTENSIONS = ['.ts', '.svelte', '.mjs', '.js', '.html'];

// API / 認証系 / Storybook 等 link 元が暗黙的な path は対象外
const EXEMPT_PATTERNS = [
	/^\/api\//,
	/^\/$/, // root は entry point として常に有効
	/^\/auth\//,
	/^\/ops\//, // ops dashboard は Cognito ops group 認可で意図的に link 隠蔽
	/^\/error-pages?/,
	/\.well-known/,
	/^\/dev\//, // dev 用 route
	/^\/proxy\//,
];

/**
 * file path -> URL path 変換
 *  src/routes/(parent)/admin/+page.svelte -> /admin
 *  src/routes/(child)/[uiMode]/home/+page.svelte -> /:uiMode/home (regex 化)
 */
function filePathToUrl(filePath) {
	const rel = path.relative(ROUTES_DIR, filePath).replace(/\\/g, '/');
	// +page.svelte / +page.server.ts / +server.ts を除去
	let p = rel.replace(/\/?\+(page|server|layout)(\.server|\.ts|\.svelte).*$/, '');
	// SvelteKit grouping `(name)` を除去
	p = p.replace(/\([^)]+\)\//g, '');
	p = p.replace(/\/?\([^)]+\)$/, '');
	// matcher `[param=matcher]` -> `[param]`
	p = p.replace(/\[([^\]=]+)(?:=[^\]]+)?\]/g, '[$1]');
	if (p === '') return '/';
	return `/${p}`;
}

function main() {
	const args = parseArgs(process.argv);
	const mode = args.updateBaseline ? 'update-baseline' : args.report ? 'report' : 'check';
	const baseline = loadBaseline('routes');

	// route file 列挙
	const routeFiles = walkDir(ROUTES_DIR, { extensions: ['.svelte'] }).filter(
		(f) => path.basename(f) === '+page.svelte',
	);

	const routeUrls = routeFiles.map((f) => ({
		file: path.relative(REPO_ROOT, f).replace(/\\/g, '/'),
		url: filePathToUrl(f),
	}));

	// EXEMPT を除外
	const targets = routeUrls.filter((r) => !EXEMPT_PATTERNS.some((p) => p.test(r.url)));

	// legacy-url-map から登録済 path を抽出
	const legacyTargets = new Set();
	if (fs.existsSync(LEGACY_URL_MAP)) {
		const legacy = fs.readFileSync(LEGACY_URL_MAP, 'utf8');
		// `to: '/foo/bar'` or `target: '/foo/bar'`
		const re = /(?:to|target|destination)\s*:\s*['"`]([^'"`]+)['"`]/g;
		for (const m of legacy.matchAll(re)) {
			legacyTargets.add(m[1]);
		}
	}

	// search source 収集 (orphan-baselines / orphan-audit ドキュメントは self-reference 除外)
	const EXCLUDE_PATTERNS = [
		/scripts[\\/]orphan-baselines[\\/]/,
		/docs[\\/]operations[\\/]orphan-audit-/,
	];
	const searchFiles = [];
	for (const d of SEARCH_DIRS) {
		const full = path.join(REPO_ROOT, d);
		if (fs.existsSync(full)) {
			searchFiles.push(
				...walkDir(full, { extensions: SEARCH_EXTENSIONS, excludePatterns: EXCLUDE_PATTERNS }),
			);
		}
	}

	const findings = targets
		.map((t) => {
			// dynamic param を含む path は wildcard match で許容 (e.g. `/[uiMode]/home` -> any path
			// containing `/home`)
			if (legacyTargets.has(t.url)) return null;

			// search: href="<url>" or goto('<url>') or redirect(..., '<url>') or `<url>`
			// dynamic path はそのまま含まれる場合に許容 (param 名一致のみ check)
			const escapedUrl = t.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			// dynamic `\[param\]` を `[^"'\\s]+` に変換して loose match
			const searchPattern = escapedUrl.replace(/\\\[[^\]]+\\\]/g, '[^"\'/\\s]+');
			const reHref = new RegExp(`href=["\`']${searchPattern}["\`'/?#]`);
			const reGoto = new RegExp(
				`(?:goto|redirect|push|replace)\\s*\\(.*["\`']${searchPattern}["\`'/?#]`,
			);
			const rePlain = new RegExp(`["\`']${searchPattern}["\`']`);

			let found = false;
			for (const file of searchFiles) {
				// 自分自身のファイルからの参照は除外
				const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
				if (rel === t.file) continue;
				let text;
				try {
					text = fs.readFileSync(file, 'utf8');
				} catch {
					continue;
				}
				if (!text.includes(t.url.split('/')[1] || t.url)) continue; // 早期 skip
				if (reHref.test(text) || reGoto.test(text) || rePlain.test(text)) {
					found = true;
					break;
				}
			}
			if (!found) {
				return {
					name: t.url,
					reason: `route "${t.url}" (${t.file}) は href / goto() / legacy-url-map から参照されていません。完全 orphan の page 候補。`,
					locations: [t.file],
					allowlisted: baseline.allowed.includes(t.url),
				};
			}
			return null;
		})
		.filter(Boolean);

	const exit = reportFindings('routes', findings, { mode, baseline });
	process.exit(exit);
}

const isMain =
	import.meta.url === `file://${(process.argv[1] || '').replace(/\\/g, '/')}` ||
	(process.argv[1] || '').endsWith('check-orphan-routes.mjs');
if (isMain) {
	main();
}
