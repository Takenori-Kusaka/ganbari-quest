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
import { MARKETPLACE_TYPE_LABELS } from '../../../src/lib/domain/marketplace-item';
import { DEMO_SITE_TERMS } from '../../../src/lib/domain/terms';
import { MARKETPLACE_TYPE_METAS_CLIENT } from '../../../src/lib/marketplace/client-types';

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

	describe('type 名の SSOT (finding 4 / PO 決裁)', () => {
		// 同じ 5 type の名前が 3 箇所に別表記で併存していた:
		//   MARKETPLACE_TYPE_LABELS / registry displayLabel は一致、MARKETPLACE_LABELS.tabs
		//   だけが 4 つ全部ズレていた (アクティビティ集 / ごほうび集 / 持ち物リスト / ルール集)。
		// DESIGN.md §6 は前 2 者の一致しか定めていなかったため、3 つ目が外側でズレ続けた。
		it('tabs の 4 つが MARKETPLACE_TYPE_LABELS と一致する', () => {
			expect(MARKETPLACE_LABELS.tabs.activities).toBe(MARKETPLACE_TYPE_LABELS['activity-pack']);
			expect(MARKETPLACE_LABELS.tabs.rewards).toBe(MARKETPLACE_TYPE_LABELS['reward-set']);
			expect(MARKETPLACE_LABELS.tabs.checklists).toBe(MARKETPLACE_TYPE_LABELS.checklist);
			expect(MARKETPLACE_LABELS.tabs.rules).toBe(MARKETPLACE_TYPE_LABELS['rule-preset']);
		});

		it('tabs / MARKETPLACE_TYPE_LABELS が同じ atom を参照し、文字列を複製しない', () => {
			// 値の一致だけでは「同じ literal を 2 箇所に書く」状態を許してしまい、片方だけ
			// 変更されたときにまたズレる。参照そのものを assert して複製の復活を落とす。
			const labelsSrc = repoFile('src/lib/domain/labels.ts');
			const tabsBlock = labelsSrc.match(/\ttabs: \{[\s\S]*?\n\t\},/)?.[0] ?? '';
			expect(tabsBlock, 'tabs ブロックが見つかる').not.toBe('');
			for (const key of ['activityPack', 'rewardSet', 'checklist', 'rulePreset'] as const) {
				expect(tabsBlock).toContain(`MARKETPLACE_TYPE_TERMS.${key}`);
			}
			expect(tabsBlock, '文字列 literal を書かない').not.toMatch(/: '/);

			const itemSrc = repoFile('src/lib/domain/marketplace-item.ts');
			const typeLabelsBlock =
				itemSrc.match(
					/export const MARKETPLACE_TYPE_LABELS: Record<MarketplaceItemType, string> = \{[\s\S]*?\n\};/,
				)?.[0] ?? '';
			expect(typeLabelsBlock, 'MARKETPLACE_TYPE_LABELS ブロックが見つかる').not.toBe('');
			expect(typeLabelsBlock).toContain('MARKETPLACE_TYPE_TERMS.');
			expect(typeLabelsBlock, '文字列 literal を書かない').not.toMatch(/: '/);
		});

		it('registry displayLabel と MARKETPLACE_TYPE_LABELS が一致する (DESIGN.md §6)', () => {
			for (const meta of MARKETPLACE_TYPE_METAS_CLIENT) {
				expect(meta.displayLabel).toBe(MARKETPLACE_TYPE_LABELS[meta.typeCode]);
			}
		});

		it('type 名に限定語を付けない (DESIGN.md §10 / チェックリストは持ち物専用ではない)', () => {
			const typeNames = Object.values(MARKETPLACE_TYPE_LABELS).join('\n');
			for (const narrowing of ['持ち物', 'もちもの']) {
				expect(typeNames).not.toContain(narrowing);
			}
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
