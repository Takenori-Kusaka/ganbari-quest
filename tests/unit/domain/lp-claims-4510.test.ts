// tests/unit/domain/lp-claims-4510.test.ts (#4510)
//
// LP / FAQ の訴求が実装事実と食い違わないことを機械検出する。
//
// # 何が壊れていたか（GAMMA 監査 第2ラウンド、claim 台帳の (c) 分類）
//   1. オフライン動作の訴求 — offline queue / background sync / IndexedDB は src に 0 件。
//      service-worker は GET のキャッシュのみで、記録 (POST) は送信できない。
//      「旅行中に記録 → 復帰時に自動同期」は **記録が残らない事故を誘導する** (data/high)
//   2. サービス終了時の書き出しがプラン無条件 — 無料プランは canExport=false (data/medium)
//   3. きょうだいランキングの「年齢差を考慮した調整」— ランキング実装に年齢調整は無い
//      (ageAdjustments はチャレンジ目標値専用。帰属誤り)
//   5. 「約 5 分で初期設定」「2 タップで記録」— 計測根拠が repo に無い数値主張
//  10. 未配線の購入手順 label — 「カード情報を入力すると無料体験が始まります（カード登録不要）」
//      という自己矛盾かつ実装と逆の文言が配信物に載っていた
//
// # なぜ test にするか
// これらは「文面を直したら終わり」ではなく、**実装が変わらない限り書けない主張**。
// 実装が先に変われば test を更新して主張を戻せる、という順序を強制する。

import { describe, expect, it } from 'vitest';
import {
	LP_FAQ_LABELS,
	LP_FAQ_PHASEB_LABELS,
	LP_HERO_SPEC_BADGES_LABELS,
	LP_INDEX_EXTRA_LABELS,
	LP_INDEX_PHASEB_LABELS,
} from '../../../src/lib/domain/labels';

/**
 * namespace の値を全て文字列化して 1 本にする (関数値は除く)。
 *
 * 各 namespace は `as const` なので値型が literal union になり、`v is string` の
 * type predicate が使えない (predicate 型が引数型に代入可能でないため)。
 */
function textOf(...namespaces: Record<string, unknown>[]): string {
	return namespaces
		.flatMap((ns) => Object.values(ns))
		.filter((v) => typeof v === 'string')
		.join('\n');
}

const allFaq = textOf(LP_FAQ_LABELS, LP_FAQ_PHASEB_LABELS);

describe('#4510 LP 訴求と実装事実の一致', () => {
	describe('オフライン動作 (finding 1 / data-high)', () => {
		it('「オフラインでも記録できる」と読める訴求が無い', () => {
			expect(allFaq).not.toContain('基本的な活動記録はオフラインでも動作します');
		});

		it('「ネット復帰時に自動同期」の訴求が無い (offline queue は未実装)', () => {
			expect(allFaq).not.toContain('自動同期');
		});

		it('記録には通信が必要であることを述べている', () => {
			expect(allFaq).toContain('記録の保存はできません');
		});
	});

	describe('サービス終了時の書き出し (finding 2 / data-medium)', () => {
		it('プラン無条件の「確実に手元に残せます」が無い', () => {
			const all = textOf(LP_INDEX_EXTRA_LABELS, LP_INDEX_PHASEB_LABELS, LP_FAQ_PHASEB_LABELS);
			expect(all).not.toContain('データの書き出しができます。お子さまの記録は確実に手元に残せます');
		});
	});

	describe('きょうだいランキング (finding 3)', () => {
		it('「年齢差を考慮した調整」の帰属誤りが無い', () => {
			expect(allFaq).not.toContain('年齢差を考慮した調整');
		});
	});

	describe('数値主張 (finding 5)', () => {
		it('計測根拠の無い「約 5 分」がヒーローに無い', () => {
			const badges = Object.values(LP_HERO_SPEC_BADGES_LABELS).join('\n');
			expect(badges).not.toContain('約 5 分');
		});

		// #4713 が本 assertion を supersede した。旧値 '300+' は activity-packs の**延べ**件数
		// (325) を根拠にしていたが、男の子 / 女の子 variant が同名活動を重複して持つため
		// **名前のユニークは 129 種**しかなく、延べ基準では「選べる種類」を 2 倍以上に見せていた
		// (ADR-0013 LP truth)。ユニーク基準の訴求値は PRESET_ACTIVITY_TERMS.uniqueCountBadge に
		// 集約され、実数を下回っていることは scripts/measure-lp-dimensions.mjs と
		// tests/unit/domain/lp-claims-implementation-truth-4713.test.ts が gate する。
		// 本 test の意図 (= プリセット数バッジを消さない) は据え置き、値だけを是正した。
		it('プリセット数バッジは残す — こちらは CI が実数を gate している', () => {
			expect(LP_HERO_SPEC_BADGES_LABELS.presetCount).toBe('120+');
		});
	});

	describe('未配線 dead payload (finding 10 / money-medium)', () => {
		it('自己矛盾した購入手順 label が labels から消えている', async () => {
			const labels = await import('../../../src/lib/domain/labels');
			for (const key of [
				'faqPurchaseStepsQ',
				'faqPurchaseStepsAIntro',
				'faqPurchaseStepsStep1',
				'faqPurchaseStepsStep2',
				'faqPurchaseStepsStep3',
			]) {
				const found = Object.values(labels).some(
					(ns) => typeof ns === 'object' && ns !== null && key in (ns as object),
				);
				expect(found, `${key} が残っています (配線された瞬間に虚偽表示になる)`).toBe(false);
			}
		});
	});

	describe('条番号の参照 (finding 8)', () => {
		it('サービス終了の参照が第 15 条 (第 14 条は卒業)', () => {
			expect(LP_FAQ_PHASEB_LABELS.k74).toContain('第 15 条');
			expect(LP_FAQ_PHASEB_LABELS.k74).not.toContain('第 14 条');
		});
	});
});
