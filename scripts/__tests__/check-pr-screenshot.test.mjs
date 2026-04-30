/**
 * scripts/__tests__/check-pr-screenshot.test.mjs
 *
 * #1740 + #1741 — PR スクリーンショットチェッカーのユニットテスト。
 *
 * 実行: node --test scripts/__tests__/check-pr-screenshot.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	detectBeforeAfterLabels,
	detectLocalPaths,
	hasUiNotApplicableMarker,
	isUiPr,
} from '../check-pr-screenshot.mjs';

// ---------------------------------------------------------------------------
// detectLocalPaths (#1741) — ローカル相対パス禁止
// ---------------------------------------------------------------------------

describe('detectLocalPaths (#1741)', () => {
	it('Markdown image with tmp/screenshots を検出する', () => {
		const body = '本文\n![before](tmp/screenshots/pr-1234/before.png)\n他の本文';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 1);
		assert.match(violations[0], /tmp\/screenshots\/pr-1234\/before\.png/);
	});

	it('Markdown image with .tmp-screenshots を検出する', () => {
		const body = '![after](.tmp-screenshots/foo.png)';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 1);
	});

	it('HTML img with tmp/ を検出する', () => {
		const body = '<img src="tmp/screenshots/x.png" alt="x">';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 1);
	});

	it('user-attachments URL は許可される（違反なし）', () => {
		const body =
			'![before](https://github.com/user-attachments/assets/abc123-uuid)\n' +
			'![after](https://github.com/user-attachments/assets/def456-uuid)';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 0);
	});

	it('screenshots branch raw URL は許可される', () => {
		const body =
			'![before](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-1234/before.png)';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 0);
	});

	it('docs/screenshots/ は raw URL ならば許可', () => {
		const body =
			'![ok](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/main/docs/screenshots/x.png)';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 0);
	});

	it('複数ローカルパスを全て検出する', () => {
		const body = '![a](tmp/x.png)\n![b](.tmp-screenshots/y.png)\n<img src="tmp/z.png" alt="z">';
		const violations = detectLocalPaths(body);
		assert.equal(violations.length, 3);
	});
});

// ---------------------------------------------------------------------------
// detectBeforeAfterLabels (#1740) — 修正前 / 修正後ラベル検証
// ---------------------------------------------------------------------------

describe('detectBeforeAfterLabels (#1740)', () => {
	it('日本語ラベル「修正前」「修正後」両方ある', () => {
		const body =
			'## SS\n![修正前-mobile](https://example.com/a.png)\n![修正後-mobile](https://example.com/b.png)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, true);
	});

	it('英語ラベル before / after 両方ある', () => {
		const body = '![before-pc](https://example.com/a.png)\n![after-pc](https://example.com/b.png)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, true);
	});

	it('混在 (修正前 + after)', () => {
		const body = '![修正前](https://x.com/a.png)\n![after-mobile](https://x.com/b.png)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, true);
	});

	it('before のみ', () => {
		const body = '![before](https://x.com/a.png)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, false);
	});

	it('after のみ', () => {
		const body = '![after](https://x.com/a.png)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, false);
		assert.equal(result.hasAfter, true);
	});

	it('画像なし', () => {
		const body = '本文のみ';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, false);
		assert.equal(result.hasAfter, false);
	});

	it('HTML img alt で「修正後」', () => {
		const body = '![修正前](url1)\n<img src="url2" alt="修正後 mobile">';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, true);
	});

	it('case-insensitive: BEFORE / After', () => {
		const body = '![BEFORE-x](url1)\n![After-y](url2)';
		const result = detectBeforeAfterLabels(body);
		assert.equal(result.hasBefore, true);
		assert.equal(result.hasAfter, true);
	});
});

// ---------------------------------------------------------------------------
// isUiPr — UI 関連ファイル判定
// ---------------------------------------------------------------------------

describe('isUiPr', () => {
	it('.svelte ファイルがあれば UI PR', () => {
		assert.equal(isUiPr(['src/routes/admin/+page.svelte']), true);
	});

	it('site/ 配下の変更も UI PR', () => {
		assert.equal(isUiPr(['site/index.html']), true);
	});

	it('.css ファイルも UI PR', () => {
		assert.equal(isUiPr(['src/lib/ui/styles/app.css']), true);
	});

	it('docs / scripts のみは UI PR ではない', () => {
		assert.equal(
			isUiPr(['docs/decisions/0001.md', 'scripts/check.mjs', '.github/workflows/ci.yml']),
			false,
		);
	});

	it('空配列', () => {
		assert.equal(isUiPr([]), false);
	});
});

// ---------------------------------------------------------------------------
// hasUiNotApplicableMarker — opt-out
// ---------------------------------------------------------------------------

describe('hasUiNotApplicableMarker', () => {
	it('「該当なし（refactor）」表記を検出', () => {
		assert.equal(hasUiNotApplicableMarker('該当なし（refactor / docs / chore）'), true);
	});

	it('「該当なし(docs)」半角括弧版も検出', () => {
		assert.equal(hasUiNotApplicableMarker('該当なし(docs only)'), true);
	});

	it('「UI 変更なし」表記も検出', () => {
		assert.equal(hasUiNotApplicableMarker('本 PR は UI 変更なし。'), true);
	});

	it('該当語句なしなら false', () => {
		assert.equal(hasUiNotApplicableMarker('普通の PR 本文'), false);
	});
});
