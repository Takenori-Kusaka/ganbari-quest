// #1783: LP HTML 内の <img src="screenshots/..."> 物理存在 gate の単体テスト

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// @ts-expect-error - .mjs script export untyped
import { findMissingScreenshots } from '../../../scripts/measure-lp-dimensions.mjs';

describe('measure-lp-dimensions — findMissingScreenshots (#1783)', () => {
	let tmpSiteDir: string;

	beforeEach(() => {
		tmpSiteDir = mkdtempSync(join(tmpdir(), 'measure-lp-test-'));
	});

	afterEach(() => {
		rmSync(tmpSiteDir, { recursive: true, force: true });
	});

	function writeFile(rel: string, content = 'dummy'): void {
		const fs = require('node:fs');
		const path = require('node:path');
		const target = path.join(tmpSiteDir, rel);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, content);
	}

	it('img src="screenshots/foo.webp" を referenced に含める', () => {
		writeFile('screenshots/foo.webp');
		const html = `<img src="screenshots/foo.webp" alt="x">`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toContain('screenshots/foo.webp');
		expect(result.missing).toEqual([]);
	});

	it('source srcset="screenshots/foo-desktop.webp" を referenced に含める', () => {
		writeFile('screenshots/foo-desktop.webp');
		const html = `<source srcset="screenshots/foo-desktop.webp" type="image/webp">`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toContain('screenshots/foo-desktop.webp');
		expect(result.missing).toEqual([]);
	});

	it('物理欠落しているファイルを missing に列挙する', () => {
		const html = `<img src="screenshots/missing.webp">`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toContain('screenshots/missing.webp');
		expect(result.missing).toContain('screenshots/missing.webp');
	});

	it('複数 ref + 一部欠落で正しく分離する', () => {
		writeFile('screenshots/has.webp');
		const html = `
			<img src="screenshots/has.webp">
			<img src="screenshots/missing-a.webp">
			<source srcset="screenshots/missing-b.webp">
		`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced.sort()).toEqual([
			'screenshots/has.webp',
			'screenshots/missing-a.webp',
			'screenshots/missing-b.webp',
		]);
		expect(result.missing.sort()).toEqual([
			'screenshots/missing-a.webp',
			'screenshots/missing-b.webp',
		]);
	});

	it('重複した ref は 1 件にまとめる', () => {
		writeFile('screenshots/foo.webp');
		const html = `
			<img src="screenshots/foo.webp">
			<source srcset="screenshots/foo.webp">
		`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toHaveLength(1);
		expect(result.referenced[0]).toBe('screenshots/foo.webp');
	});

	it('screenshots/ 以外のパスは無視する (#1783 scope)', () => {
		const html = `
			<img src="logos/brand.svg">
			<img src="static/icon.png">
		`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toEqual([]);
		expect(result.missing).toEqual([]);
	});

	it('絶対パス /screenshots/foo.webp も補足する', () => {
		writeFile('screenshots/foo.webp');
		const html = `<img src="/screenshots/foo.webp">`;
		const result = findMissingScreenshots(html, tmpSiteDir);
		expect(result.referenced).toContain('screenshots/foo.webp');
		expect(result.missing).toEqual([]);
	});
});
