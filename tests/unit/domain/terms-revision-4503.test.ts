// tests/unit/domain/terms-revision-4503.test.ts (#4503)
//
// 利用規約の条項不足・誤約束の再発を機械検出する。
//
// # 何を守るか
// GAMMA 監査 (#4495) で terms.html 全 20 条と実装を双方向突合した結果、契約文書として
// 次の欠落・誤りが確定した。いずれも**文面を書き換えるだけでは再発を防げない**ため、
// 「実装事実と一致していること」を test で固定する。
//
//   1. 第7条6 の「保持期間は第13条に定めます」が空参照 (第13条には退会猶予しかない)
//   2. プラン変更の条項が無いまま、ダウングレードで履歴が物理削除される
//   3. 第14条3 が運営者の金銭債務 (ポイントの現金還元) を約束していた
//   5. 第8条4 の「1アカウントにつき1回」が実装 (家族グループ単位) と乖離
//   6. 第8条2 の「トライアル中に解約した場合」— カード不要でサブスク契約が発生しない
//
// 値 (保持期間・猶予日数) は atom を参照しているかを見る。文字列で書くと
// PLAN_HISTORY_RETENTION_DAYS を変えたときに規約だけ古くなる。

import { describe, expect, it } from 'vitest';
import { LP_LEGAL_TERMS_LABELS } from '../../../src/lib/domain/labels';
import { PLAN_FULL_TERMS, PLAN_RETENTION_TERMS } from '../../../src/lib/domain/terms';

const section7 = LP_LEGAL_TERMS_LABELS.section7;
const section8 = LP_LEGAL_TERMS_LABELS.section8;
const section14 = LP_LEGAL_TERMS_LABELS.section14;

describe('#4503 利用規約の改訂', () => {
	describe('第7条 — 保持期間とプラン変更 (finding 1 / 2)', () => {
		it('空参照「保持期間は本規約第13条に定めます」が残っていない', () => {
			expect(section7).not.toContain('保持期間は本規約第13条に定めます');
		});

		it('プラン別の履歴保持期間を atom から述べている (規約だけ古くならない)', () => {
			expect(section7).toContain('プラン別の履歴保持期間');
			expect(section7).toContain(PLAN_RETENTION_TERMS.free);
			expect(section7).toContain(PLAN_RETENTION_TERMS.standard);
			expect(section7).toContain('無期限');
		});

		it('保持期間を超えた履歴が削除され復元できないことを述べている', () => {
			expect(section7).toContain('削除され');
			expect(section7).toContain('復元できません');
		});

		it('プラン変更の条項があり、ダウングレードで履歴が削除されることを述べている', () => {
			expect(section7).toContain('プラン変更');
			expect(section7).toContain('ダウングレード');
			// downgrade-service が実際に物理削除する事実を、規約が明示していること
			expect(section7).toMatch(/保持期間を超える履歴は削除されます/);
		});
	});

	describe('第8条 — 無料トライアル (finding 5 / 6)', () => {
		it('「トライアル中に解約」型の文言が残っていない (解約する対象が存在しない)', () => {
			expect(section8).not.toContain('無料トライアル期間中に解約した場合');
		});

		it('カード不要・自動課金なしを述べている (LP の訴求と整合)', () => {
			expect(section8).toContain('お支払い情報の登録は不要');
			expect(section8).toContain('自動的に料金が発生することはありません');
		});

		it('1 回制限の単位が家族グループである (実装は tenant 単位)', () => {
			expect(section8).not.toContain('1アカウントにつき1回');
			expect(section8).toContain('ご家族（家族グループ）につき1回');
		});

		it('キャンペーン等による再提供の例外を述べている (campaign / admin_grant)', () => {
			expect(section8).toContain('キャンペーン');
		});
	});

	describe('第14条 — 卒業 (finding 3 / 4)', () => {
		it('運営者の金銭債務 (現金・物品での還元) を約束していない', () => {
			expect(section14).not.toContain('現金または物品での還元');
			expect(section14).toContain('換金・買取・払い戻しを行いません');
		});

		it('ポイントが金銭的価値ではないことを述べている', () => {
			expect(section14).toContain('金銭的価値ではありません');
		});

		it('stale な「実装は今後のリリースで提供予定」が残っていない', () => {
			expect(section14).not.toContain('今後のリリースで提供予定');
		});

		it('エクスポート導線を実装どおり (退会手続き画面) に述べている', () => {
			expect(section14).toContain('退会');
			expect(section14).not.toContain('データのエクスポートまたは削除を選択');
		});
	});

	describe('版数 (AC: 再同意の発火)', () => {
		it('最終更新日 (header) と最終改定日 (末尾) が一致する', () => {
			const header = LP_LEGAL_TERMS_LABELS.articleHeader.match(
				/最終更新日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/,
			)?.[1];
			const revised = LP_LEGAL_TERMS_LABELS.effective.match(
				/最終改定日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/,
			)?.[1];
			expect(header).toBeDefined();
			expect(header).toBe(revised);
		});

		it('プラン名は atom 経由で書かれている (旧称が混ざらない)', () => {
			expect(section7).toContain(PLAN_FULL_TERMS.free);
			expect(section7).not.toContain('ファミリープラン');
		});
	});
});
