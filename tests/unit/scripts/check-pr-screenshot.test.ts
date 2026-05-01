/**
 * tests/unit/scripts/check-pr-screenshot.test.ts (#1766 / #1747 AC4)
 *
 * scripts/check-pr-screenshot.mjs の純粋関数（検出ロジック）の unit test。
 * メイン処理 (main) は env 経由で動作するため、export された関数を直接呼んで検証する。
 */

import { describe, expect, it } from 'vitest';

import {
	detectBeforeAfterLabels,
	detectLocalPaths,
	extractImageUrls,
	hasDomSnapshotReference,
	hasUiNotApplicableMarker,
	isScreenshotUrl,
	isUiPr,
} from '../../../scripts/check-pr-screenshot.mjs';

describe('isUiPr (#1740)', () => {
	it('.svelte ファイルがあれば true', () => {
		expect(isUiPr(['src/routes/foo/+page.svelte'])).toBe(true);
	});

	it('.css / .scss があれば true', () => {
		expect(isUiPr(['src/lib/ui/styles/app.css'])).toBe(true);
		expect(isUiPr(['src/lib/foo.scss'])).toBe(true);
	});

	it('site/ 配下のファイルなら true', () => {
		expect(isUiPr(['site/index.html'])).toBe(true);
	});

	it('.ts のみ・docs のみは false', () => {
		expect(isUiPr(['src/lib/server/db/schema.ts'])).toBe(false);
		expect(isUiPr(['docs/design/06-UI設計書.md'])).toBe(false);
		expect(isUiPr(['scripts/capture.mjs'])).toBe(false);
	});
});

describe('detectLocalPaths (#1741)', () => {
	it('tmp/ パス Markdown 画像を検出', () => {
		const body = '![before-mobile](tmp/screenshots/pr-1/before-mobile.png)';
		expect(detectLocalPaths(body)).toHaveLength(1);
	});

	it('.tmp-screenshots/ パスを検出', () => {
		const body = '![x](.tmp-screenshots/foo.png)';
		expect(detectLocalPaths(body)).toHaveLength(1);
	});

	it('GitHub raw URL は false (検出されない)', () => {
		const body =
			'![ok](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/ok.png)';
		expect(detectLocalPaths(body)).toHaveLength(0);
	});
});

describe('detectBeforeAfterLabels (#1740)', () => {
	it('before / after 両方検出', () => {
		const body = `
![before-mobile](https://example.com/b.png)
![after-mobile](https://example.com/a.png)
`;
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(true);
		expect(result.hasAfter).toBe(true);
	});

	it('日本語ラベル「修正前 / 修正後」も検出', () => {
		const body = `
![修正前](https://example.com/b.png)
![修正後](https://example.com/a.png)
`;
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(true);
		expect(result.hasAfter).toBe(true);
	});

	it('after だけのときは hasBefore=false', () => {
		const body = '![after-mobile](https://example.com/a.png)';
		const result = detectBeforeAfterLabels(body);
		expect(result.hasBefore).toBe(false);
		expect(result.hasAfter).toBe(true);
	});
});

describe('hasUiNotApplicableMarker', () => {
	it('「該当なし（refactor）」を検出', () => {
		expect(hasUiNotApplicableMarker('該当なし（refactor / docs / chore）')).toBe(true);
	});

	it('「UI 変更なし」を検出', () => {
		expect(hasUiNotApplicableMarker('## SS\nUI 変更なし')).toBe(true);
	});

	it('UI 変更がある PR は false', () => {
		expect(hasUiNotApplicableMarker('![ss](url)')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// #1766 / #1747 AC4: DOM スナップショット参照検出
// ---------------------------------------------------------------------------

describe('extractImageUrls (#1766)', () => {
	it('Markdown 画像の URL を抽出', () => {
		const body = '![alt](https://example.com/foo.png)';
		expect(extractImageUrls(body)).toEqual(['https://example.com/foo.png']);
	});

	it('複数 Markdown 画像を抽出', () => {
		const body = `
![a](https://x.com/a.png)
![b](https://x.com/b.webp)
`;
		expect(extractImageUrls(body)).toEqual(['https://x.com/a.png', 'https://x.com/b.webp']);
	});

	it('HTML img タグからも URL を抽出', () => {
		const body = '<img src="https://x.com/bar.png" alt="bar">';
		expect(extractImageUrls(body)).toEqual(['https://x.com/bar.png']);
	});

	it('画像参照がない場合は空配列', () => {
		expect(extractImageUrls('Hello world')).toEqual([]);
	});
});

describe('isScreenshotUrl (#1766)', () => {
	it('.png は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.png')).toBe(true);
	});

	it('.webp は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.webp')).toBe(true);
	});

	it('.jpg / .jpeg は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.jpg')).toBe(true);
		expect(isScreenshotUrl('https://example.com/foo.jpeg')).toBe(true);
	});

	it('.gif は true', () => {
		expect(isScreenshotUrl('https://example.com/foo.gif')).toBe(true);
	});

	it('クエリ文字列付き URL も判定可能', () => {
		expect(isScreenshotUrl('https://example.com/foo.png?v=123')).toBe(true);
		expect(isScreenshotUrl('https://example.com/foo.webp#frag')).toBe(true);
	});

	it('user-attachments の uuid (拡張子なし) は false', () => {
		expect(
			isScreenshotUrl('https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb'),
		).toBe(false);
	});

	it('.dom.html は false', () => {
		expect(isScreenshotUrl('https://example.com/foo.dom.html')).toBe(false);
	});
});

describe('hasDomSnapshotReference (#1766 / #1747 AC4)', () => {
	it('Markdown link 形式の .dom.html を検出', () => {
		const body = '[DOM HTML](https://example.com/foo.dom.html)';
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('GitHub raw URL の .dom.html を検出', () => {
		const body = `[DOM](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1766/admin-home-mobile.dom.html)`;
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('素の URL（リンク化されていない）も検出', () => {
		const body = `参照: https://example.com/foo.dom.html`;
		expect(hasDomSnapshotReference(body)).toBe(true);
	});

	it('SS だけ・DOM 参照なしは false', () => {
		const body = `
![before-mobile](https://example.com/before.png)
![after-mobile](https://example.com/after.png)
`;
		expect(hasDomSnapshotReference(body)).toBe(false);
	});

	it('「dom.html」という単語が文中に出るだけでは false（URL 文脈が必要）', () => {
		const body = 'DOM スナップショット (.dom.html) は未対応';
		// URL ではなく説明文中の言及なので検出されない
		expect(hasDomSnapshotReference(body)).toBe(false);
	});
});
