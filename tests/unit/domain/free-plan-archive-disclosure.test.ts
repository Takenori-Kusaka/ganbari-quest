// tests/unit/domain/free-plan-archive-disclosure.test.ts (#4585-4)
//
// 無料プランに戻ったときに「上限を超える分がアーカイブされること」と「それが削除ではなく
// 有料プランに戻せば元に戻ること」を、**顧客が実際に通る 3 経路すべて**で述べていることを固定する。
//
// 実装事実 (ここに書いてよい範囲):
//   - `archiveExcessResources` が上限超過分を archive する (削除しない)
//   - `restoreArchivedResources` が 3 reason (`trial_expired` / `downgrade_user_selected` /
//     `dunning_canceled`) すべてを復元する → **どの経路で archive されても再契約で戻る** (#4585-3)
//   - fallback で「直近の利用順」に残すのは**子供だけ**。活動 / チェックリストは登録順のまま
//     (PO 決裁 Q1)。全資源に敷衍した規則を顧客提示物に書くと嘘になる
//
// これが無いと:
//   - 「復元できる」旨が落ちても誰も気づかず、実際には戻せるのに諦める顧客が出る (PO 決裁 4 本目)
//   - 支払い失敗で契約が終わった顧客 (解約画面を通れない唯一の経路) が、超過分が見えなくなった
//     理由をどこでも知れないまま「記録はそのまま残ります」という告知だけを読むことになる

import { describe, expect, it } from 'vitest';
import { ARCHIVED_REASONS } from '../../../src/lib/domain/archive-types';
import { CONTRACT_STATE, CONTRACT_STATE_VIEW } from '../../../src/lib/domain/contract-state-view';
import {
	CANCELLATION_LABELS,
	LP_LEGAL_TOKUSHOHO_LABELS,
	SUBSCRIPTION_PAGE_LABELS,
} from '../../../src/lib/domain/labels';

/** 特商法「解約とデータの取扱い」の段落だけを取り出す。 */
function tokushohoCancellationDataSection(): string {
	const table = LP_LEGAL_TOKUSHOHO_LABELS.tableContent;
	const start = table.indexOf('解約とデータの取扱い');
	expect(start).toBeGreaterThan(-1);
	const end = table.indexOf('アカウント', start + 1);
	return table.slice(start, end === -1 ? undefined : end);
}

describe('#4585-4 アーカイブの扱いを顧客提示物で述べる', () => {
	describe('解約画面 (顧客自身が解約手続きを踏む経路)', () => {
		it('「選ばずに進めた場合」に何が残るかを述べている', () => {
			const rule = CANCELLATION_LABELS.archiveFallbackRule(2, 10, 3);
			expect(rule).toContain('アーカイブ');
		});

		it('アーカイブが削除ではなく元に戻せることを述べている', () => {
			expect(CANCELLATION_LABELS.archiveFallbackRestore).toContain('削除しません');
			expect(CANCELLATION_LABELS.archiveFallbackRestore).toContain('元に戻せます');
		});

		// PO 決裁 Q1: 「直近の利用順」は子供だけ。活動・チェックリストは登録順のまま。
		// 全資源に敷衍した規則を書くと実装と食い違う (顧客に対して嘘になる)。
		it('「最近記録がある順」を子供以外の資源に敷衍していない', () => {
			const rule = CANCELLATION_LABELS.archiveFallbackRule(2, 10, 3);
			const mentions = rule.match(/最近記録/g) ?? [];
			expect(mentions).toHaveLength(1);
			expect(rule).not.toMatch(/活動[^。]*最近記録/);
			expect(rule).not.toMatch(/チェックリスト[^。]*最近記録/);
			expect(rule).not.toMatch(/最近記録[^。]*活動/);
			expect(rule).not.toMatch(/最近記録[^。]*チェックリスト/);
		});
	});

	describe('契約終了の告知 (支払い失敗で契約が終わった顧客が着く唯一の画面)', () => {
		const view = CONTRACT_STATE_VIEW[CONTRACT_STATE.CANCELLED];

		it('上限超過分がアーカイブされることを述べている', () => {
			expect(view.statusNotice?.desc).toContain('上限を超える分');
			expect(view.statusNotice?.desc).toContain('アーカイブ');
		});

		it('解約画面と同一の「戻せる」文を共有している', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.cancelledDesc).toContain(
				CANCELLATION_LABELS.archiveFallbackRestore,
			);
		});

		it('書き込みが続けられる保証文を落としていない (#4156 の回帰 guard)', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.cancelledDesc).toContain(
				SUBSCRIPTION_PAGE_LABELS.writesContinueAssurance,
			);
		});

		// 契約が残っている S4 (支払い停止) では archive はまだ起きていない
		// (`archiveForDunningCancellation` は subscription.deleted = S5 で走る)。
		// ここに archive の話を足すと、起きていないことを述べることになる。
		it('契約が残っている停止中 (S4) にはアーカイブの話を持ち込まない', () => {
			expect(SUBSCRIPTION_PAGE_LABELS.paymentSuspendedDesc).not.toContain('アーカイブ');
			expect(SUBSCRIPTION_PAGE_LABELS.gracePeriodDesc).not.toContain('アーカイブ');
		});
	});

	describe('特商法「解約とデータの取扱い」', () => {
		it('上限超過分がアーカイブされ画面に出なくなることを述べている', () => {
			const section = tokushohoCancellationDataSection();
			expect(section).toContain('上限を超える');
			expect(section).toContain('アーカイブ');
			expect(section).toContain('表示されなくなります');
		});

		it('削除ではなく有料プランに戻せば元に戻ることを述べている', () => {
			const section = tokushohoCancellationDataSection();
			expect(section).toContain('削除はされず');
			expect(section).toContain('元どおりご利用いただけます');
		});

		it('支払い失敗で契約が終わった場合も同じ取扱いであることを述べている', () => {
			expect(tokushohoCancellationDataSection()).toContain(
				'お支払いの失敗により契約が終了した場合',
			);
		});
	});

	// 「有料プランに戻すと元に戻る」と書いてよいのは、全 reason が復元対象だから (#4585-3)。
	// 復元が全 reason を covers していることの assert は
	// `tests/unit/services/resource-archive-service.test.ts` (#4585-3) が持つ。ここでは
	// **reason 集合が動いたら本ファイルの文言を見直す**ことを強制するために集合を固定する。
	it('reason 集合が動いたら顧客提示物の「元に戻せる」を見直す', () => {
		expect([...ARCHIVED_REASONS].sort()).toEqual(
			['downgrade_user_selected', 'dunning_canceled', 'trial_expired'].sort(),
		);
	});
});
