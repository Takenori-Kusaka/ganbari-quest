// tests/unit/domain/legal-docs-implementation-truth-4709.test.ts (#4709)
//
// 法務文書（特商法 / プライバシーポリシー / SLA）と FAQ / 料金ページの記述が、実装の事実および
// 相互に一致していることを pin する。#4709 で観測された乖離:
//
//   1. 特商法「支払時期 初回: 7 日間無料トライアルから開始」— 実装は checkout 即時課金
//      （`stripe-service.ts` は `trial_period_days` を使わない）
//   2. privacy 第 3 条 / 第 8 条が生成 AI の用途を「活動アイコン生成」と開示 — #4397 で廃止済。
//      実際に送っている領収書画像（OCR）は未記載
//   3. 問い合わせ応答目標が FAQ / 特商法 / SLA で 3 通り
//   4. 「必要な記録は保持期間内にエクスポートしてください」— 無料プランは `canExport:false` で 403

import { describe, expect, it } from 'vitest';
import {
	LP_FAQ_LABELS,
	LP_FAQ_PHASEB_LABELS,
	LP_LEGAL_PRIVACY_LABELS,
	LP_LEGAL_SLA_LABELS,
	LP_LEGAL_TOKUSHOHO_LABELS,
	LP_PRICING_LABELS,
	PRICING_PAGE_LABELS,
} from '../../../src/lib/domain/labels';
import { SUPPORT_RESPONSE_TERMS } from '../../../src/lib/domain/terms';

describe('#4709 特商法の支払時期が checkout 即時課金と一致する', () => {
	const table = LP_LEGAL_TOKUSHOHO_LABELS.tableContent;

	it('初回課金がお申し込み時であることを述べている', () => {
		expect(table).toContain('お申し込み（決済手続き）の完了時に初回分を課金');
	});

	it('「初回はトライアルから開始」と述べていない（Stripe trial_period_days 不使用）', () => {
		expect(table).not.toMatch(/初回:\s*7\s*日間無料トライアルから開始/);
		expect(table).not.toMatch(/有料プランは\s*7\s*日間無料トライアルから開始/);
	});

	it('無料体験が課金を伴わない別手続きであることを述べている', () => {
		expect(table).toContain('課金を伴');
		expect(table).toContain('アプリ内で開始');
	});

	it('#4540 Q1 申し送り: 「記録はそのまま保持されます」の「そのまま」を落としている', () => {
		// 直後に「無料プランの履歴保持期間は 90 日」が続くため、「そのまま」は矛盾して読める
		expect(table).not.toMatch(/記録はそのまま保持されます/);
		expect(table).toContain('記録は保持されます');
	});
});

describe('#4709 privacy の生成 AI 用途が実送信経路と一致する', () => {
	const clauses = [LP_LEGAL_PRIVACY_LABELS.section3, LP_LEGAL_PRIVACY_LABELS.section8];

	it('廃止済みの「活動アイコン生成」を開示していない (#4397 で機能ごと撤去)', () => {
		for (const c of clauses) {
			expect(c).not.toMatch(/活動アイコン/);
		}
	});

	it('実際に送っている領収書画像の読み取りを開示している', () => {
		for (const c of clauses) {
			expect(c).toContain('領収書');
		}
	});

	it('AI 提案 4 種（活動・ごほうび・チェックリスト・応援メッセージ）を開示している', () => {
		for (const c of clauses) {
			for (const t of ['活動', 'ごほうび', 'チェックリスト', '応援メッセージ']) {
				expect(c).toContain(t);
			}
		}
	});
});

describe('#4709 問い合わせ応答目標が 3 文書で一致する', () => {
	const target = SUPPORT_RESPONSE_TERMS.initialResponseTarget;

	it('SLA 第 6 条が atom を参照している', () => {
		expect(LP_LEGAL_SLA_LABELS.section6).toContain(target);
	});

	it('特商法が atom を参照している', () => {
		expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain(target);
	});

	it('FAQ が atom を参照している', () => {
		expect(LP_FAQ_LABELS.text124).toContain(target);
		expect(LP_FAQ_PHASEB_LABELS.k121).toContain(target);
	});

	it('旧表記（3 通りに割れていた値）が残っていない', () => {
		const all = [
			LP_LEGAL_SLA_LABELS.section6,
			LP_LEGAL_TOKUSHOHO_LABELS.tableContent,
			LP_FAQ_LABELS.text124,
			LP_FAQ_PHASEB_LABELS.k121,
		].join('\n');
		expect(all).not.toMatch(/1\s*〜\s*2\s*営業日以内/);
		expect(all).not.toMatch(/即日〜翌営業日/);
	});
});

describe('#4709 エクスポートの提供条件が canExport gate と一致する', () => {
	const texts = [
		LP_PRICING_LABELS.faqCancelA,
		PRICING_PAGE_LABELS.faqCancelA,
		LP_FAQ_LABELS.text22,
		LP_FAQ_PHASEB_LABELS.k22,
	];

	it('無条件に「保持期間内にエクスポートしてください」と案内していない', () => {
		for (const t of texts) {
			expect(t).not.toMatch(/必要な記録は保持期間内にエクスポートしてください/);
		}
	});

	it('有料プラン限定であることと、無料プランの代替手段を述べている', () => {
		for (const t of texts) {
			expect(t).toContain('記録の書き出し（エクスポート）は');
			expect(t).toContain('のお手続きの画面から');
		}
	});
});
