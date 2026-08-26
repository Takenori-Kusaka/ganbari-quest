// tests/unit/domain/sla-promises-4508.test.ts (#4508)
//
// SLA が「実行できない運用」を確約していないことを機械検出する。
//
// # 何が壊れていたか
// site/sla.html は通知経路として **Discord の公開ステータスチャンネル**を挙げていたが、
// 利用者がそこへ到達する導線が無い (招待リンク無効化済み / 公開招待廃止 / サーバーは
// 有料ユーザー限定方針)。さらに「1 時間超の障害では登録メールへ通知も行います」という
// 全ユーザー一斉メールの機構・手順は repo に存在しない。有償サービスの表示として
// 履行不能な確約になっていた (ADR-0013: 未整備の運用を記載しない)。
//
// # なぜ test で固定するか
// 文面を弱めるだけでは、次に SLA を触るときに「あったほうが体裁が良い」経路が戻る。
// **到達導線を実際に用意しない限り書けない**ことを、文字列の不在で pin する。

import { describe, expect, it } from 'vitest';
import { LP_LEGAL_SLA_LABELS, LP_LEGAL_TOKUSHOHO_LABELS } from '../../../src/lib/domain/labels';

const sla = Object.values(LP_LEGAL_SLA_LABELS).join('\n');

describe('#4508 SLA が履行できない確約を持たない', () => {
	describe('通知経路 (finding 1 / 2)', () => {
		it('Discord を利用者向けの通知経路として挙げていない (到達導線が存在しない)', () => {
			// privacy の第3条は Discord を「運用監視通知の外部サービス」として開示しており、
			// そちらは事実。SLA が **利用者の受信経路**として挙げるのが誤りだった。
			expect(sla).not.toContain('Discord');
		});

		it('「1 時間を超える場合はメール通知も行います」型の確約が無い', () => {
			expect(sla).not.toMatch(/1時間を超える場合は、登録メールアドレスへの通知も行います/);
		});

		it('現に実行できる経路 (サービス内のお知らせ) を通知経路として述べている', () => {
			expect(LP_LEGAL_SLA_LABELS.section5).toContain('本サービス内のお知らせ');
			expect(LP_LEGAL_SLA_LABELS.section3).toContain('本サービス内のお知らせ');
		});

		it('メール連絡は断定ではなく可能性の表現になっている', () => {
			expect(LP_LEGAL_SLA_LABELS.section5).toContain('ご連絡する場合があります');
		});
	});

	describe('期間延長の申請手続き (finding 4)', () => {
		it('申請先が明記されている (受付方法未定義のまま「申請できます」と書かない)', () => {
			expect(LP_LEGAL_SLA_LABELS.section7).toContain('サポートメール');
			expect(LP_LEGAL_SLA_LABELS.section7).toContain('mailto:');
		});
	});

	describe('応答目標の文書間整合 (finding 3)', () => {
		it('特商法表記の「即日〜翌営業日に返信」という断定が無い', () => {
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).not.toContain('即日〜翌営業日に返信');
		});

		it('特商法表記が SLA 第6条 (48 時間 = 2 営業日 目標) と同じ強さで書かれている', () => {
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain('2 営業日以内');
			expect(LP_LEGAL_TOKUSHOHO_LABELS.tableContent).toContain('目標');
			// SLA 側は従来どおり「48時間以内（営業日ベース）を目標」
			expect(LP_LEGAL_SLA_LABELS.section6).toContain('48時間以内');
			expect(LP_LEGAL_SLA_LABELS.section6).toContain('目標');
		});
	});

	describe('改定日', () => {
		it('header の最終更新日と末尾の最終改定日が一致する', () => {
			const updated = LP_LEGAL_SLA_LABELS.articleHeader.match(
				/最終更新日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/,
			)?.[1];
			const revised = LP_LEGAL_SLA_LABELS.effective.match(
				/最終改定日\s*[:：]\s*(\d{4}年\d{1,2}月\d{1,2}日)/,
			)?.[1];
			expect(updated).toBeDefined();
			expect(updated).toBe(revised);
		});
	});
});
