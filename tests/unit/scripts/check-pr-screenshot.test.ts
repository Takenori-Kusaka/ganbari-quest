/**
 * tests/unit/scripts/check-pr-screenshot.test.ts (#1766 / #1747 AC4)
 *
 * scripts/check-pr-screenshot.mjs の純粋関数（検出ロジック）の unit test。
 * メイン処理 (main) は env 経由で動作するため、export された関数を直接呼んで検証する。
 */

import { describe, expect, it } from 'vitest';

import {
	checkScreenshotEmbedReadiness,
	detectBeforeAfterLabels,
	detectLocalPaths,
	extractImageUrls,
	hasDomSnapshotReference,
	hasEmbeddedScreenshotImage,
	hasFutureTenseScreenshotMarker,
	hasUiNotApplicableMarker,
	isScreenshotUrl,
	isUiPr,
	isUserAttachmentAssetUrl,
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

	it('user-attachments の uuid (拡張子なし) は false (拡張子判定に限定。embed 判定は isUserAttachmentAssetUrl 側で許容 #2929)', () => {
		expect(
			isScreenshotUrl('https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb'),
		).toBe(false);
	});

	it('.dom.html は false', () => {
		expect(isScreenshotUrl('https://example.com/foo.dom.html')).toBe(false);
	});
});

describe('isUserAttachmentAssetUrl (#2929 項目 1)', () => {
	it('GitHub user-attachments の uuid URL は true', () => {
		expect(
			isUserAttachmentAssetUrl(
				'https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb',
			),
		).toBe(true);
	});

	it('http (非 https) は false', () => {
		expect(
			isUserAttachmentAssetUrl('http://github.com/user-attachments/assets/9c6c8430-1234'),
		).toBe(false);
	});

	it('user-attachments 以外の github.com URL は false', () => {
		expect(isUserAttachmentAssetUrl('https://github.com/Takenori-Kusaka/ganbari-quest')).toBe(
			false,
		);
		expect(
			isUserAttachmentAssetUrl(
				'https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/a.png',
			),
		).toBe(false);
	});

	it('偽装ドメイン (github.com.evil.example) は false', () => {
		expect(
			isUserAttachmentAssetUrl('https://github.com.evil.example/user-attachments/assets/abc'),
		).toBe(false);
	});

	it('uuid 後に path / query が続く非正規形は false', () => {
		expect(
			isUserAttachmentAssetUrl('https://github.com/user-attachments/assets/abc/../../evil'),
		).toBe(false);
		expect(isUserAttachmentAssetUrl('https://github.com/user-attachments/assets/abc?x=1')).toBe(
			false,
		);
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

// ---------------------------------------------------------------------------
// #2918: SS embed 未完了 (未来形 / embed 不在) の検出 + Ready 化前ゲート
// ---------------------------------------------------------------------------

describe('hasFutureTenseScreenshotMarker (#2918)', () => {
	it('「screenshots branch へ push する」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('SS は screenshots branch へ push する')).toBe(true);
	});

	it('「スクリーンショットは後で添付します」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('スクリーンショットは後で添付します')).toBe(true);
	});

	it('「TODO: スクショ追加」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('TODO: スクショ追加')).toBe(true);
	});

	it('「SS は別途撮影します」を検出', () => {
		expect(hasFutureTenseScreenshotMarker('SS は別途撮影します')).toBe(true);
	});

	it('embed 済みの完了形 PR body は false', () => {
		const body =
			'## SS\n![after-mobile](https://raw.githubusercontent.com/x/y/screenshots/pr-1/a.png)';
		expect(hasFutureTenseScreenshotMarker(body)).toBe(false);
	});
});

describe('hasEmbeddedScreenshotImage (#2918)', () => {
	it('GitHub raw URL の embed 画像があれば true', () => {
		const body =
			'![after](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1/after.png)';
		expect(hasEmbeddedScreenshotImage(body)).toBe(true);
	});

	it('HTML img の remote URL embed も true', () => {
		expect(hasEmbeddedScreenshotImage('<img src="https://example.com/a.webp">')).toBe(true);
	});

	it('ローカルパス参照のみは false (embed とみなさない)', () => {
		expect(hasEmbeddedScreenshotImage('![x](tmp/screenshots/pr-1/x.png)')).toBe(false);
	});

	it('テキストのみ・画像 0 件は false', () => {
		expect(hasEmbeddedScreenshotImage('## SS\n| 修正前 | 修正後 |\n|---|---|\n| a | b |')).toBe(
			false,
		);
	});

	it('拡張子なし user-attachments の uuid も embed として true (#2929 項目 1 — PR template / dev-session.md の正規手段案内と整合)', () => {
		expect(
			hasEmbeddedScreenshotImage(
				'![x](https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb)',
			),
		).toBe(true);
	});
});

describe('checkScreenshotEmbedReadiness (#2918 — Ready 化前ゲート)', () => {
	// case 1: UI 変更あり + SS embed なし → fail (違反検出)
	it('UI 変更あり + SS embed なし → violations を返す (fail)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## 変更内容\nボタンの色を変えた。SS は後で push する。',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		const ids = result.violations.map((v) => v.id);
		expect(ids).toContain('screenshot-embed-missing');
		expect(ids).toContain('future-tense-screenshot');
	});

	it('UI 変更あり + テキスト表のみ (embed 0 件) → fail (#2914 再現)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n| 修正前 | 修正後 |\n|---|---|\n| 旧 | 新 |',
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations.map((v) => v.id)).toContain('screenshot-embed-missing');
	});

	it('UI 変更あり + ローカルパス参照のみ → fail (#2913 再現)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '![before](tmp/screenshots/2894/before.png)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		const ids = result.violations.map((v) => v.id);
		// ローカルパス禁止 (#1741) + embed 不在 (#2918) の両方を検出
		expect(ids).toContain('local-path-forbidden');
		expect(ids).toContain('screenshot-embed-missing');
	});

	// case 2: UI 変更あり + SS embed あり → pass (違反なし)
	it('UI 変更あり + GitHub raw URL embed あり → 違反なし (pass)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n![after-mobile](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-2918/after-mobile.png)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + user-attachments embed のみ → 違反なし (pass、#2929 項目 1 false-positive 解消)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '## SS\n![after-mobile](https://github.com/user-attachments/assets/9c6c8430-1234-5678-aaaa-bbbb)',
			files: ['src/routes/admin/+page.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(false);
		expect(result.violations).toHaveLength(0);
	});

	// case 3: docs-only → skip (UI 変更なしで検証スキップ)
	it('docs / .ts のみ変更 (UI 変更なし) → skip (違反なし)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '本文に embed 画像なし',
			files: ['docs/CLAUDE.md', 'src/lib/server/db/schema.ts'],
			labels: [],
		});
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toBe('UI 関連ファイル変更なし');
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + 「該当なし（refactor）」明示 → skip', () => {
		const result = checkScreenshotEmbedReadiness({
			body: 'SS: 該当なし（refactor / docs / chore）',
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: [],
		});
		expect(result.skipped).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it('UI 変更あり + refactor:internal-no-doc-impact ラベル → skip (exempt 互換維持)', () => {
		const result = checkScreenshotEmbedReadiness({
			body: '内部 refactor。SS は後で push する。', // 未来形があっても exempt label で skip
			files: ['src/lib/ui/primitives/Button.svelte'],
			labels: ['refactor:internal-no-doc-impact'],
		});
		expect(result.skipped).toBe(true);
		expect(result.violations).toHaveLength(0);
	});
});
