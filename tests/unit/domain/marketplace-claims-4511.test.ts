// tests/unit/domain/marketplace-claims-4511.test.ts (#4511)
//
// marketplace（みんなのテンプレート）面の死に導線・説明不整合を機械検出する。
//
// # 何が壊れていたか（GAMMA 監査 第2ラウンド）
//   1. 「デモを体験」CTA が `href="/demo"` — legacy redirect → `/` → 未認証は `/auth/login`。
//      デモは #2181 で demo.ganbari-quest.com へ移設済みで、LP 側 CTA は切替済みだった。
//      **marketplace だけ取り残され、「デモを体験」と表示してログイン画面へ誘導**していた
//   2. meta description が 4 type 訴求 — 陳列は #2896 で 3 type（rule-preset はブラウズ不可）
//   3. rule-preset 詳細に内部語彙が露出 —「ADR-0012 anti-engagement 細則」「no-op」
//      （現データでは非到達の休眠分岐だが live コード）
//   4. checklist 取込説明が実在しない画面名「持ち物リスト」を引用
//      （実際の子供画面名は icons.ts SSOT の もちもの / もちものチェック / 持ち物チェック）

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getModeLabels } from '../../../src/lib/domain/icons';
import { MARKETPLACE_LABELS } from '../../../src/lib/domain/labels';
import { DEMO_SITE_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

describe('#4511 marketplace の導線と説明', () => {
	describe('デモ CTA (finding 1)', () => {
		it('CTA の href が実在するデモ環境を指す (旧 /demo は死に導線)', () => {
			expect(MARKETPLACE_LABELS.backToDemoHref).toBe(DEMO_SITE_TERMS.url);
			expect(MARKETPLACE_LABELS.backToDemoHref).toContain('demo.ganbari-quest.com');
		});

		it('page が href を直書きせず label 経由で参照する (移設のたびの取りこぼしを防ぐ)', () => {
			const page = repoFile('src/routes/marketplace/+page.svelte');
			expect(page).toContain('MARKETPLACE_LABELS.backToDemoHref');
			expect(page, '旧 /demo の直書きが残っていない').not.toMatch(/href="\/demo"/);
		});

		it('LP 側の CTA と同じ遷移先である (LP だけ切替済みの状態に戻らない)', () => {
			const lpLabels = repoFile('src/lib/domain/labels.ts');
			// LP は https://demo.ganbari-quest.com/ を使っている (#2181)
			expect(lpLabels).toContain(`midHref: '${DEMO_SITE_TERMS.url}'`);
		});
	});

	describe('meta description (finding 2)', () => {
		it('陳列していない type (特別ルール) を訴求しない', () => {
			expect(MARKETPLACE_LABELS.metaDescription).not.toContain('特別ルール');
		});

		it('陳列 3 type を訴求している', () => {
			for (const t of ['活動', 'ごほうび', 'チェックリスト']) {
				expect(MARKETPLACE_LABELS.metaDescription).toContain(t);
			}
		});
	});

	describe('内部語彙の露出 (finding 3)', () => {
		it('顧客向けテキストに ADR 番号が出ない', () => {
			expect(MARKETPLACE_LABELS.detailCtaImportRuleDescPenalty).not.toContain('ADR-');
			expect(MARKETPLACE_LABELS.detailCtaImportRuleDescPenalty).not.toContain('anti-engagement');
		});

		it('顧客向けテキストに no-op が出ない', () => {
			expect(MARKETPLACE_LABELS.detailCtaImportRuleDescSpecial).not.toContain('no-op');
		});

		it('「使えない / 準備中」という事実は伝えている (説明を消すだけにしない)', () => {
			expect(MARKETPLACE_LABELS.detailCtaImportRuleDescPenalty).toContain('ご利用いただけません');
			expect(MARKETPLACE_LABELS.detailCtaImportRuleDescSpecial).toContain('準備中');
		});
	});

	describe('画面名の引用 (finding 4)', () => {
		it('実在しない画面名「持ち物リスト」を引用しない', () => {
			// namespace は `as const` で値型が literal union になるため、素朴な flatMap では
			// 型が合わない。文字列化してから 1 本にする。
			const values: unknown[] = Object.values(MARKETPLACE_LABELS);
			const all = values
				.flatMap((v) => (typeof v === 'object' && v !== null ? Object.values(v) : [v]))
				.filter((v): v is string => typeof v === 'string')
				.join('\n');
			expect(all).not.toContain('持ち物リスト');
		});

		it('引用する画面名が icons.ts の実名称に含まれる', () => {
			// 子供画面の checklist 名は年齢帯ごとに もちもの / もちものチェック / 持ち物チェック
			const actualNames = ['baby', 'preschool', 'elementary', 'junior', 'senior'].map(
				(mode) => getModeLabels(mode).checklist,
			);
			expect(actualNames).toContain('もちものチェック');
			expect(MARKETPLACE_LABELS.detailCtaImportChecklistDesc).toContain('もちものチェック');
		});
	});
});
