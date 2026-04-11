import type { RequestHandler } from './$types';

/**
 * SvelteKit 動的 sitemap.xml エンドポイント (#832)
 *
 * 配信対象はクロール許可ページのみ。認証領域 (/admin, /ops, /api, /switch, /tenants,
 * /setup, /demo/admin, /view, /uploads) は static/robots.txt で Disallow 済み。
 *
 * ドメイン分離:
 *   - LP (GitHub Pages): https://www.ganbari-quest.com/ — site/sitemap.xml
 *   - App (CloudFront):  https://ganbari-quest.com/     — 本エンドポイント
 */

const SITE_ORIGIN = 'https://ganbari-quest.com';

type SitemapEntry = {
	loc: string;
	lastmod: string;
	changefreq: 'weekly' | 'monthly' | 'yearly';
	priority: string;
};

const LAST_MOD = '2026-04-11';

/**
 * 登録対象はアプリドメインで「公開 + 静的コンテンツ + 認証不要」のもののみ。
 *   - `/` はログイン状態により redirect するため登録しない
 *   - `/consent` は認証必須なので登録しない
 *   - `/legal/*` は LP (www.ganbari-quest.com/terms.html 等) への 301 なので LP sitemap が担当
 *   - `/admin`, `/ops`, `/api`, `/switch`, `/tenants`, `/setup`, `/demo/admin`, `/view`, `/uploads`
 *     は robots.txt で Disallow 済み
 */
const ENTRIES: readonly SitemapEntry[] = [
	{ loc: '/pricing', lastmod: LAST_MOD, changefreq: 'monthly', priority: '0.9' },
	{ loc: '/auth/login', lastmod: LAST_MOD, changefreq: 'monthly', priority: '0.5' },
];

function buildSitemapXml(): string {
	const urls = ENTRIES.map(
		(e) =>
			`  <url>\n    <loc>${SITE_ORIGIN}${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
	).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const GET: RequestHandler = async () => {
	return new Response(buildSitemapXml(), {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
			'cache-control': 'public, max-age=3600',
		},
	});
};

export const prerender = true;
