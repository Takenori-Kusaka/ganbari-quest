/**
 * tests/unit/scripts/generate-sitemap.test.ts (#1908)
 *
 * scripts/generate-sitemap.mjs の純粋関数 (副作用なし) を検証する。
 * git log / fs 書き出しは間接的に collectHtmlFiles 経由 + 一時ディレクトリで検証。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	buildSitemapXml,
	collectHtmlFiles,
	resolvePriority,
} from '../../../scripts/generate-sitemap.mjs';

describe('resolvePriority (#1908 AC3)', () => {
	it('ルート / は priority 1.0 / weekly', () => {
		expect(resolvePriority('/')).toEqual({ priority: '1.0', changefreq: 'weekly' });
	});

	it('pricing.html は priority 0.9 / monthly', () => {
		expect(resolvePriority('/pricing.html')).toEqual({ priority: '0.9', changefreq: 'monthly' });
	});

	it('faq.html は priority 0.8 / monthly (#1908 AC4)', () => {
		expect(resolvePriority('/faq.html')).toEqual({ priority: '0.8', changefreq: 'monthly' });
	});

	it('graduation.html は priority 0.8 / monthly (#1908 AC4)', () => {
		expect(resolvePriority('/graduation.html')).toEqual({
			priority: '0.8',
			changefreq: 'monthly',
		});
	});

	it('pamphlet.html は priority 0.7 / monthly', () => {
		expect(resolvePriority('/pamphlet.html')).toEqual({ priority: '0.7', changefreq: 'monthly' });
	});

	it('selfhost.html は priority 0.6 / monthly', () => {
		expect(resolvePriority('/selfhost.html')).toEqual({ priority: '0.6', changefreq: 'monthly' });
	});

	it('help/ 配下は priority 0.5 / monthly (#1908 AC4)', () => {
		// resolvePriority は path prefix ルールの純関数。`/help/` 配下の代表パスで検証。
		// (旧 /help/license-key.html は #2836 PR-L4 で削除済だが prefix ルール自体は維持)
		expect(resolvePriority('/help/getting-started.html')).toEqual({
			priority: '0.5',
			changefreq: 'monthly',
		});
	});

	it('terms / privacy / tokushoho / sla 等は catch-all で priority 0.4 / yearly', () => {
		expect(resolvePriority('/terms.html')).toEqual({ priority: '0.4', changefreq: 'yearly' });
		expect(resolvePriority('/privacy.html')).toEqual({ priority: '0.4', changefreq: 'yearly' });
		expect(resolvePriority('/tokushoho.html')).toEqual({ priority: '0.4', changefreq: 'yearly' });
		expect(resolvePriority('/sla.html')).toEqual({ priority: '0.4', changefreq: 'yearly' });
	});

	it('未知の path も catch-all で 0.4 / yearly を返す', () => {
		expect(resolvePriority('/unknown-future.html')).toEqual({
			priority: '0.4',
			changefreq: 'yearly',
		});
	});
});

describe('buildSitemapXml (#1908 AC1)', () => {
	it('XML 宣言と urlset / 自動生成コメントを含む', () => {
		const xml = buildSitemapXml([]);
		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<!-- 自動生成: scripts/generate-sitemap.mjs (#1908)');
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml).toContain('</urlset>');
	});

	it('entry 配列を <url> ブロックに変換する', () => {
		const xml = buildSitemapXml([
			{ url: '/', lastmod: '2026-05-09', priority: '1.0', changefreq: 'weekly' },
			{ url: '/faq.html', lastmod: '2026-05-07', priority: '0.8', changefreq: 'monthly' },
		]);
		expect(xml).toContain('<loc>https://www.ganbari-quest.com/</loc>');
		expect(xml).toContain('<loc>https://www.ganbari-quest.com/faq.html</loc>');
		expect(xml).toContain('<lastmod>2026-05-09</lastmod>');
		expect(xml).toContain('<lastmod>2026-05-07</lastmod>');
		expect(xml).toContain('<priority>1.0</priority>');
		expect(xml).toContain('<priority>0.8</priority>');
	});

	it('空配列でも valid XML を生成する', () => {
		const xml = buildSitemapXml([]);
		expect(xml).toMatch(/^<\?xml/);
		expect(xml).toContain('</urlset>');
		// <url> 要素は含まれない
		expect(xml).not.toContain('<url>');
	});
});

describe('collectHtmlFiles (#1908 AC1 / AC4)', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-sitemap-test-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it('site 直下の index.html を / に正規化', () => {
		fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
		const result = collectHtmlFiles(tmpDir);
		expect(result).toContain('/');
	});

	it('site 直下の HTML を /<name>.html として収集', () => {
		fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
		fs.writeFileSync(path.join(tmpDir, 'pricing.html'), '<html></html>');
		fs.writeFileSync(path.join(tmpDir, 'faq.html'), '<html></html>');
		const result = collectHtmlFiles(tmpDir);
		expect(result).toEqual(['/', '/faq.html', '/pricing.html']);
	});

	it('subdir (例: help/) を再帰的に列挙し /help/<name>.html として収集 (#1908 AC4)', () => {
		fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
		fs.mkdirSync(path.join(tmpDir, 'help'));
		fs.writeFileSync(path.join(tmpDir, 'help', 'license-key.html'), '<html></html>');
		const result = collectHtmlFiles(tmpDir);
		expect(result).toEqual(['/', '/help/license-key.html']);
	});

	it('非 HTML ファイル (sitemap.xml / robots.txt / .webp 等) は除外', () => {
		fs.writeFileSync(path.join(tmpDir, 'index.html'), '<html></html>');
		fs.writeFileSync(path.join(tmpDir, 'sitemap.xml'), '<?xml ?>');
		fs.writeFileSync(path.join(tmpDir, 'robots.txt'), '');
		fs.writeFileSync(path.join(tmpDir, 'image.webp'), '');
		const result = collectHtmlFiles(tmpDir);
		expect(result).toEqual(['/']);
	});

	it('list は alphabetical sort される (決定的出力)', () => {
		fs.writeFileSync(path.join(tmpDir, 'zebra.html'), '<html></html>');
		fs.writeFileSync(path.join(tmpDir, 'alpha.html'), '<html></html>');
		fs.writeFileSync(path.join(tmpDir, 'mid.html'), '<html></html>');
		const result = collectHtmlFiles(tmpDir);
		expect(result).toEqual(['/alpha.html', '/mid.html', '/zebra.html']);
	});
});

describe('full sitemap structure (#1908 AC4 / AC5 integration)', () => {
	it('実際の site/ を走査した sitemap が faq / graduation を含む', () => {
		// 実 repo の site/ をそのまま読む。Issue #1908 で stale 解消したページを必ず含むこと
		// 注: 旧 help/license-key は Epic #2525 Phase 7 PR-L4 (#2836) license key 全廃で削除済。
		const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
		const siteDir = path.join(repoRoot, 'site').replace(/^\\/, ''); // Windows 互換
		const siteDirNormalized = fs.existsSync(siteDir) ? siteDir : path.resolve('site');
		if (!fs.existsSync(siteDirNormalized)) {
			// CI 等で site/ が無い環境では skip
			return;
		}
		const urls = collectHtmlFiles(siteDirNormalized);
		// AC4: faq / graduation が網羅されること
		expect(urls).toContain('/faq.html');
		expect(urls).toContain('/graduation.html');
		// 旧 help/license-key.html は削除済のため sitemap に含まれないこと (#2836 PR-L4)
		expect(urls).not.toContain('/help/license-key.html');
		// 既存の 8 ページも維持されていること
		expect(urls).toContain('/');
		expect(urls).toContain('/pricing.html');
		expect(urls).toContain('/selfhost.html');
		expect(urls).toContain('/pamphlet.html');
		expect(urls).toContain('/terms.html');
		expect(urls).toContain('/privacy.html');
		expect(urls).toContain('/tokushoho.html');
		expect(urls).toContain('/sla.html');
	});
});
