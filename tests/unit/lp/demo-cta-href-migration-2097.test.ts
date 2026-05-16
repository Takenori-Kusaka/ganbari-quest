/**
 * tests/unit/lp/demo-cta-href-migration-2097.test.ts (#2097 Phase B-10, ADR-0048)
 *
 * LP の「デモを見る」CTA href が新しい Multi-Lambda 専用ドメイン
 * `https://demo.ganbari-quest.com/` を指していることを構造的に保証する回帰防止テスト。
 *
 * 設計背景:
 *   ADR-0048 (Multi-Lambda demo deployment) で demo は専用 Lambda + 専用 CloudFront +
 *   `demo.ganbari-quest.com` で配信する構成に移行した。一方、LP 各ページの「デモを見る」CTA は
 *   旧 URL `https://ganbari-quest.com/demo` (= 本番 Lambda /demo ルート) を指したままで、
 *   ADR-0048 の投資が LP 流入に反映されていなかった (A-6 ISSUE-005)。
 *
 *   本テストは LP 4 ページ + 3 法務・補助ページの該当 anchor 9 件 + labels.ts SSOT 4 件が
 *   全て新ドメインを指すことを assert し、誤って旧 URL に戻る regression を構造的に防止する。
 *
 * 検査対象:
 *   - site/index.html, site/faq.html, site/pricing.html
 *   - site/sla.html, site/tokushoho.html, site/help/license-key.html
 *   - site/shared-labels.js (labels.ts から自動生成、SSOT 反映確認用)
 *   - src/lib/domain/labels.ts (LP_FLOATING_CTA_LABELS.midHref / LP_INDEX_PHASEB_LABELS.k13/k17/k18)
 *
 * AC マッピング (Issue #2097 Phase B-10):
 *   - AC1: LP 全ファイルから `ganbari-quest.com/demo` (旧 URL) が消滅していること
 *   - AC2: LP 全ファイルに `demo.ganbari-quest.com/` (新 URL) が出現していること
 *   - AC3: labels.ts SSOT 4 箇所 (midHref / k13 / k17 / k18) が新 URL を使っていること
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');

const LP_FILES = [
	'site/index.html',
	'site/faq.html',
	'site/pricing.html',
	'site/sla.html',
	'site/tokushoho.html',
	'site/help/license-key.html',
	'site/shared-labels.js',
];

const LABELS_TS = 'src/lib/domain/labels.ts';

const OLD_URL = 'https://ganbari-quest.com/demo';
const NEW_URL = 'https://demo.ganbari-quest.com/';

describe('LP demo CTA href migration (#2097 Phase B-10, ADR-0048)', () => {
	for (const rel of LP_FILES) {
		const abs = path.join(REPO_ROOT, rel);
		it(`AC1: ${rel} には旧 URL '${OLD_URL}' が含まれないこと`, () => {
			const content = readFileSync(abs, 'utf8');
			// `https://ganbari-quest.com/demo` (path /demo) が出現しないこと。
			// `https://demo.ganbari-quest.com/` は別文字列なので false match しない。
			// 末尾境界 (" / ' / 行末) で / 以外が続かないことを確認する厳密な regex。
			const regex = /https:\/\/ganbari-quest\.com\/demo(?![a-zA-Z0-9_-])/;
			const match = content.match(regex);
			if (match) {
				throw new Error(
					`旧 URL '${OLD_URL}' が残存しています。新 URL '${NEW_URL}' に置換してください。\n` +
						`File: ${rel}\nMatch: ${match[0]}`,
				);
			}
		});
	}

	it(`AC2: LP 配下ファイル合計で新 URL '${NEW_URL}' が 13 件出現すること`, () => {
		let total = 0;
		for (const rel of LP_FILES) {
			const abs = path.join(REPO_ROOT, rel);
			const content = readFileSync(abs, 'utf8');
			const matches = content.match(/https:\/\/demo\.ganbari-quest\.com\//g);
			if (matches) total += matches.length;
		}
		// 内訳 (2026-05-16 時点):
		//   site/index.html         : 4 (hero CTA + age-panel k13 + age-panel k17 + age-switcher k18)
		//   site/faq.html           : 1 (bottom CTA)
		//   site/pricing.html       : 1 (bottom CTA)
		//   site/sla.html           : 1 (header nav)
		//   site/tokushoho.html     : 1 (header nav)
		//   site/help/license-key.html : 1 (header nav)
		//   site/shared-labels.js   : 4 (midHref + k13 + k17 + k18)
		//   ─────────────────────────────
		//   合計                    : 13
		expect(total).toBe(13);
	});

	it(`AC3: labels.ts SSOT に新 URL '${NEW_URL}' が 4 箇所存在すること (midHref / k13 / k17 / k18)`, () => {
		const content = readFileSync(path.join(REPO_ROOT, LABELS_TS), 'utf8');
		const matches = content.match(/https:\/\/demo\.ganbari-quest\.com\//g);
		expect(matches).not.toBeNull();
		expect(matches?.length ?? 0).toBe(4);
	});

	it(`AC3: labels.ts SSOT に旧 URL '${OLD_URL}' が残存しないこと`, () => {
		const content = readFileSync(path.join(REPO_ROOT, LABELS_TS), 'utf8');
		const regex = /https:\/\/ganbari-quest\.com\/demo(?![a-zA-Z0-9_-])/;
		const match = content.match(regex);
		if (match) {
			throw new Error(
				`labels.ts SSOT に旧 URL が残存しています。\nMatch: ${match[0]}\n` +
					`修正方針: midHref / k13 / k17 / k18 の 4 箇所を新 URL に置換し、` +
					`scripts/generate-lp-labels.mjs を実行して site/shared-labels.js を再生成する。`,
			);
		}
	});
});
