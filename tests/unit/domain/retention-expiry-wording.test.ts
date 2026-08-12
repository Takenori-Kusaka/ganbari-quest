// tests/unit/domain/retention-expiry-wording.test.ts (#4528)
//
// 保持期間を過ぎた記録の扱いを顧客に述べる文言が、実装の事実 (物理削除) より弱く
// 述べられていないことを機械検証する。
//
// 実装 (`src/lib/server/services/retention-cleanup-service.ts`) は
// `recorded_date < cutoffDate` の活動ログ・ポイント台帳・ステータス履歴を行ごと削除する。
// 復元手段は無く、上位プランに戻しても戻らない。にもかかわらず
// 「閲覧できなくなります」と述べると、顧客は「戻せばまた見られる」と誤解したまま
// 不可逆な操作を確定させる (#4528。#4496 = LP・特商法 / #4507 = メール と同一クラスの欠陥)。
//
// PO が #4496 / #4507 で確定した強さは「削除され、復元できません（再契約でも戻りません）」。
// 婉曲化 (「閲覧できなくなります」「閲覧不可」等) への差し戻しを本 test が落として止める。

import { describe, expect, it } from 'vitest';
import {
	formatRetentionPeriod,
	PLAN_HISTORY_RETENTION_DAYS,
} from '../../../src/lib/domain/constants/plan-retention';
import { DOWNGRADE_RESOURCE_SELECTOR_LABELS } from '../../../src/lib/domain/labels';

/**
 * #4496 / #4507 で確定した「述べ切る」表現の構成要素。
 * 文全体の一致ではなく要素で見るのは、画面ごとに前段 (遷移の説明など) が異なるため。
 */
const REQUIRED_PHRASES = ['削除され', '復元できません', '再契約でも戻りません'] as const;

/** 婉曲化の差し戻しパターン。実装が物理削除なので「閲覧」系に弱めてはならない。 */
const FORBIDDEN_PHRASES = [
	'閲覧できなくなります',
	'閲覧できなくなり',
	'閲覧不可',
	'閲覧できません',
] as const;

/** SSOT が null (無期限) では「短縮」の前提が成立しないので、穴埋めせず落とす。 */
const requireDays = (value: number | null, name: string): number => {
	if (value === null) {
		throw new Error(`${name} が null (無期限) では本テストの前提が成立しない`);
	}
	return value;
};

const free = requireDays(PLAN_HISTORY_RETENTION_DAYS.free, 'free');
const standard = requireDays(PLAN_HISTORY_RETENTION_DAYS.standard, 'standard');

describe('保持期間切れの説明は物理削除の事実どおりに述べる (#4528)', () => {
	// 現プランが有限 / 無制限の両経路を見る (無制限側の分岐だけ婉曲表現が残る事故を防ぐ)
	const cases: ReadonlyArray<{ name: string; currentDays: number | null }> = [
		{ name: 'スタンダード → 無料 (有限 → 有限)', currentDays: standard },
		{ name: 'プレミアム → 無料 (無制限 → 有限)', currentDays: null },
	];

	describe.each(cases)('ダウングレード確認ダイアログ: $name', ({ currentDays }) => {
		const warning = DOWNGRADE_RESOURCE_SELECTOR_LABELS.retentionWarning(currentDays, free);

		it.each(REQUIRED_PHRASES)('「%s」まで述べ切っている', (phrase) => {
			expect(warning).toContain(phrase);
		});

		it.each(FORBIDDEN_PHRASES)('婉曲表現「%s」に弱めていない', (phrase) => {
			expect(warning).not.toContain(phrase);
		});

		it('短縮される前後の保持期間を SSOT 整形で述べている', () => {
			// 「何が消えるか」の判断に必要な移行の情報を、削除の記述と引き換えに落としていない
			expect(warning).toContain(formatRetentionPeriod(free));
			expect(warning).toContain('短縮されます');
		});
	});
});
