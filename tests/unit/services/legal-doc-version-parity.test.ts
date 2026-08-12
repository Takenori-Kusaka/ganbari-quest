// tests/unit/services/legal-doc-version-parity.test.ts
// #4497 (GAMMA-PRIV-01): 法的文書の「最終改定日」⇄ 同意 version 定数の突合 fitness function。
//
// なぜ機械 guard が要るか:
//   privacy.html は 2026-04-28 以降に実質的変更を 3 回 (卒業事例公開の新設 / 無料プラン削除猶予の
//   即時化 = 利用者不利変更 / CDN ログ + アクセス先 URL の収集追加) 経ているのに
//   CURRENT_PRIVACY_VERSION は '2026-04-28' のままだった。既存利用者は「同意済み」のままで、
//   新規の同意記録も旧 version で保存され続ける = 表示文書と同意証跡の恒常不一致。
//   同型の不整合は #593 で一度是正済みだが機械強制が無く再発した (same-class 2 回目) ため、
//   ADR-0061 §2 に従い guard を入れる。
//
// 検査する不変条件 (3 本):
//   A. 文書内の日付が 1 つに揃っている  — header の「最終更新日」== 末尾の「最終改定日」
//      (#4497 finding #4: 条文を足したのに header の日付だけ据え置かれる虚偽表示状態を検出する)
//   B. SSOT と配信物が一致している      — labels.ts (SSOT) の日付 == site/*.html (fallback) の日付
//   C. 文書と同意証跡が一致している      — 文書の改定日 == consent-service.ts の version 定数
//
// C が本 guard の主目的。以後 privacy.html / terms.html の改定日を動かしたら、
// 対応する version 定数を上げない限り本テストが落ちる。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LP_LEGAL_PRIVACY_LABELS, LP_LEGAL_TERMS_LABELS } from '../../../src/lib/domain/labels';

// consent-service は import 時に db factory / logger を引くため、定数だけ読むのに必要な最小 mock。
vi.mock('$lib/server/db/factory', () => ({ getRepos: () => ({ auth: {} }) }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 「2026年8月7日」→「2026-08-07」。見つからなければ undefined（呼び出し側で fail させる）。 */
function toIsoDate(japaneseDate: string | undefined): string | undefined {
	if (!japaneseDate) return undefined;
	const m = japaneseDate.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
	if (!m) return undefined;
	return `${m[1]}-${m[2]?.padStart(2, '0')}-${m[3]?.padStart(2, '0')}`;
}

/** 「最終更新日: 2026年8月7日」等のラベル付き日付を ISO で取り出す。 */
function extractLabeledDate(
	source: string,
	label: '最終更新日' | '最終改定日',
): string | undefined {
	const m = source.match(new RegExp(`${label}\\s*[:：]\\s*(\\d{4}年\\d{1,2}月\\d{1,2}日)`));
	return toIsoDate(m?.[1]);
}

function readSiteFile(relative: string): string {
	return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

interface LegalDoc {
	/** テスト表示名 */
	name: string;
	/** 配信される静的 HTML (data-lp-key の fallback テキストを持つ) */
	htmlPath: string;
	/** labels.ts 側の SSOT (LP へは generate-lp-labels.mjs 経由で配信される) */
	labels: { articleHeader: string; effective: string };
	/** 同意記録に焼かれる version 定数名 (エラーメッセージ用) */
	versionConstName: 'CURRENT_PRIVACY_VERSION' | 'CURRENT_TERMS_VERSION';
	/** consent-service.ts の実値 */
	version: string;
}

const { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } = await import(
	'../../../src/lib/server/services/consent-service'
);

const DOCS: LegalDoc[] = [
	{
		name: 'privacy',
		htmlPath: 'site/privacy.html',
		labels: LP_LEGAL_PRIVACY_LABELS,
		versionConstName: 'CURRENT_PRIVACY_VERSION',
		version: CURRENT_PRIVACY_VERSION,
	},
	{
		name: 'terms',
		htmlPath: 'site/terms.html',
		labels: LP_LEGAL_TERMS_LABELS,
		versionConstName: 'CURRENT_TERMS_VERSION',
		version: CURRENT_TERMS_VERSION,
	},
];

describe('#4497 法的文書の改定日 ⇄ 同意 version 定数の突合 (fitness function)', () => {
	for (const doc of DOCS) {
		describe(doc.name, () => {
			const updatedInLabels = extractLabeledDate(doc.labels.articleHeader, '最終更新日');
			const revisedInLabels = extractLabeledDate(doc.labels.effective, '最終改定日');

			it('A. labels.ts SSOT 内で header「最終更新日」と末尾「最終改定日」が一致する', () => {
				expect(
					updatedInLabels,
					`${doc.name}: labels.ts の articleHeader から「最終更新日」を読み取れませんでした`,
				).toBeDefined();
				expect(
					revisedInLabels,
					`${doc.name}: labels.ts の effective から「最終改定日」を読み取れませんでした`,
				).toBeDefined();
				expect(
					updatedInLabels,
					`${doc.name}: 文書内で日付が食い違っています (header=${updatedInLabels} / 末尾=${revisedInLabels})。` +
						' 条文を変えたら両方を同じ日付に更新してください。',
				).toBe(revisedInLabels);
			});

			it('B. 配信 HTML の fallback 日付が labels.ts SSOT と一致する', () => {
				const html = readSiteFile(doc.htmlPath);
				expect(
					extractLabeledDate(html, '最終更新日'),
					`${doc.htmlPath}: header の日付が labels.ts (${updatedInLabels}) と一致しません。` +
						' labels.ts を直したあと同じ値を HTML の fallback にも反映してください。',
				).toBe(updatedInLabels);
				expect(
					extractLabeledDate(html, '最終改定日'),
					`${doc.htmlPath}: 末尾の日付が labels.ts (${revisedInLabels}) と一致しません。`,
				).toBe(revisedInLabels);
			});

			it('C. 改定日が consent-service.ts の version 定数と一致する', () => {
				expect(
					doc.version,
					`${doc.name}: 文書の最終改定日は ${revisedInLabels} ですが ${doc.versionConstName} は` +
						` '${doc.version}' です。文書を改定したら version 定数も同じ日付へ上げてください` +
						' (上げないと既存利用者に再同意が発火せず、新規の同意記録も旧 version で保存されます)。' +
						' 呼称変更等で再同意が不要と判断した場合は、改定日を動かさない運用とセットで判断してください。',
				).toBe(revisedInLabels);
			});
		});
	}

	it('version 定数は YYYY-MM-DD 形式である (改定日と直接突合できる形を保つ)', () => {
		for (const doc of DOCS) {
			expect(doc.version, `${doc.versionConstName}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});
