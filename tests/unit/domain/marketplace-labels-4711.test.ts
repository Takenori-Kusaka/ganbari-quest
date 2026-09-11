/**
 * tests/unit/domain/marketplace-labels-4711.test.ts
 *
 * #4711: marketplace 取込・表示の文言 fitness function。
 *
 *   - 取込 CTA は取込 4 type (activity-pack / reward-set / checklist / rule-preset) で
 *     `detailCtaImportUnified` / `detailCtaImportUnifiedSignedOut` の 2 つだけを使う
 *     (旧: type ごとに 4 様 + 「ルールセット」等 type 名と不一致の語)
 *   - 年齢自動フィルタの案内は名前があるとき敬称を重ねない (「さくらちゃんお子さま」)
 *   - rule-preset の CTA 説明に内部語 (penalty / special / no-op / ADR) を出さない
 *   - admin/settings/rules の種類違い案内は内部 ID ではなく表示名で組む
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	ADMIN_RULES_PAGE_LABELS,
	MARKETPLACE_FILTER_LABELS,
	MARKETPLACE_LABELS,
} from '$lib/domain/labels';
import { CHILD_TERMS } from '$lib/domain/terms';

const DETAIL_PAGE = resolve(process.cwd(), 'src/routes/marketplace/[type]/[itemId]/+page.svelte');

describe('#4711 marketplace 取込 CTA の統一', () => {
	it('CTA 文言は「このテンプレートを取り込む (N件)」形で、英字 / 内部 ID を含まない', () => {
		const cta = MARKETPLACE_LABELS.detailCtaImportUnified(12);
		expect(cta).toBe('このテンプレートを取り込む (12件)');
		expect(cta).not.toMatch(/[A-Za-z]/);
		expect(MARKETPLACE_LABELS.detailCtaImportUnifiedSignedOut).not.toMatch(/[A-Za-z]/);
	});

	it('詳細ページの取込 CTA は統一 label 2 種以外を使わない (type 別 CTA 文言の再発防止)', () => {
		const src = readFileSync(DETAIL_PAGE, 'utf-8');
		const used = new Set(
			Array.from(src.matchAll(/MARKETPLACE_LABELS\.(detailCtaImport\w+)/g), (m) => m[1] ?? ''),
		);
		// 説明文 (Desc) / 未ログイン補足 (SignedOut hint) / 子供未登録 (NoChildren) は CTA 本体ではない
		const ctaOnly = Array.from(used).filter(
			(k) => !/Desc|NoChildren/.test(k) && k !== 'detailCtaImportRewardSignedOut',
		);
		expect(ctaOnly.sort()).toEqual(
			[
				'detailCtaImportActivityPackSignedOut',
				'detailCtaImportRuleSignedOut',
				'detailCtaImportUnified',
				'detailCtaImportUnifiedSignedOut',
			].sort(),
		);
		// 旧 type 別 CTA 文言は labels からも消えている
		expect(MARKETPLACE_LABELS).not.toHaveProperty('detailCtaImportRuleWithCount');
		expect(MARKETPLACE_LABELS).not.toHaveProperty('detailCtaImportRewardWithCount');
		expect(MARKETPLACE_LABELS).not.toHaveProperty('detailCtaImportActivityPackSelected');
	});

	it('rule-preset の CTA 説明に内部語を出さない', () => {
		for (const text of [
			MARKETPLACE_LABELS.detailCtaImportRuleDescPenalty,
			MARKETPLACE_LABELS.detailCtaImportRuleDescSpecial,
			MARKETPLACE_LABELS.detailCtaImportRuleDescBonus,
			MARKETPLACE_LABELS.detailCtaImportRuleDescExchange,
		]) {
			expect(text).not.toMatch(/penalty|special|no-op|ADR|bonus|exchange/i);
		}
	});
});

describe('#4711 年齢自動フィルタ案内の敬称', () => {
	it('名前があるときは敬称を重ねない', () => {
		const text = MARKETPLACE_FILTER_LABELS.autoAgeFilterApplied('さくらちゃん', '中学生 (13-15歳)');
		expect(text).toBe('さくらちゃん (中学生 (13-15歳)) に合わせて表示中');
		expect(text).not.toContain(CHILD_TERMS.honorific);
	});
	it('名前が無いときだけ敬称で呼ぶ', () => {
		expect(MARKETPLACE_FILTER_LABELS.autoAgeFilterApplied('', '中学生 (13-15歳)')).toContain(
			CHILD_TERMS.honorific,
		);
	});
});

describe('#4711 admin/settings/rules 種類違い案内', () => {
	it('表示名で組み、「時間をおいて再試行」の誤案内ではなく行き先を示す', () => {
		const text = ADMIN_RULES_PAGE_LABELS.importToastWrongType('よふかしパス');
		expect(text).toContain('よふかしパス');
		expect(text).not.toContain('再試行');
		expect(ADMIN_RULES_PAGE_LABELS.importWrongTypeExchangeHint).toContain('ごほうび管理');
		expect(ADMIN_RULES_PAGE_LABELS.importWrongTypeGoToRewards).toContain('ごほうび管理');
	});
});
