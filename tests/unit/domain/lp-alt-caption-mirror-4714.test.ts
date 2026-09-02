// tests/unit/domain/lp-alt-caption-mirror-4714.test.ts (#4714)
//
// LP の SS キャプション (`data-label`) と画像 `alt` は、`data-lp-key` の innerHTML 注入
// (`site/shared-labels.js` の applyLpKeys) の対象外で、属性値として HTML に手書き mirror される。
// そのため labels.ts 側だけを直しても HTML の alt は古いまま残り、SS と説明文が食い違う。
// 実測 (#4714): carousel 3 が「自己管理ダッシュボード」(実 UI に無い) / carousel 4 が
// 「お子さま管理タブ」(実画面名は「こども管理」) / soft-features の SS alt が「月次レポート画面 —
// 活動・ポイント推移グラフ」(実際は /admin/status の成長レポート) のまま配信されていた。
//
// 本 test は「labels.ts の値が index.html の属性に mirror されているか」を pin する。
// 注入機構を増やさずに drift を機械検出するのが目的 (Pre-PMF、ADR-0010)。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LP_INDEX_PHASEB_LABELS } from '../../../src/lib/domain/labels';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INDEX_HTML = readFileSync(join(REPO_ROOT, 'site/index.html'), 'utf8');

/** index.html の全 `alt="..."` 値。 */
const altValues = [...INDEX_HTML.matchAll(/\balt="([^"]*)"/g)].map((m) => m[1]);
/** index.html の全 `data-label="..."` 値。 */
const dataLabelValues = [...INDEX_HTML.matchAll(/\bdata-label="([^"]*)"/g)].map((m) => m[1]);

describe('#4714 hero carousel の alt / data-label が labels.ts と一致する', () => {
	const slides = [
		LP_INDEX_PHASEB_LABELS.carouselSlide1Alt,
		LP_INDEX_PHASEB_LABELS.carouselSlide2Alt,
		LP_INDEX_PHASEB_LABELS.carouselSlide3Alt,
		LP_INDEX_PHASEB_LABELS.carouselSlide4Alt,
	];

	it.each(slides.map((v, i) => [i + 1, v]))('slide %i の alt が index.html にある', (_i, value) => {
		expect(altValues).toContain(value);
	});

	it.each(
		slides.map((v, i) => [i + 1, v]),
	)('slide %i の data-label が index.html にある', (_i, value) => {
		expect(dataLabelValues).toContain(value);
	});

	it('実 UI に無い旧表現が残っていない', () => {
		// 「自己管理ダッシュボード」に相当する UI は junior ホームに存在しない
		expect(INDEX_HTML).not.toMatch(/自己管理ダッシュボード/);
		// 実画面名は「こども管理」であって「お子さま管理タブ」ではない
		expect(INDEX_HTML).not.toMatch(/お子さま管理タブ/);
	});
});

describe('#4714 soft-features の SS alt が labels.ts と一致する', () => {
	it('成長レポート SS の alt が labels.ts の値と一致する', () => {
		expect(altValues).toContain(LP_INDEX_PHASEB_LABELS.softMonthlyReportImgAlt);
	});

	it('撮影していない画面 (活動・ポイント推移グラフ) を alt で述べていない', () => {
		expect(INDEX_HTML).not.toMatch(/活動・ポイント推移グラフ/);
	});
});
