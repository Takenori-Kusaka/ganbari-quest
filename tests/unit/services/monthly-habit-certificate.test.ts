// tests/unit/services/monthly-habit-certificate.test.ts
//
// #4172 — 褒める対象を「記録の量」から「習慣化」へ変える (PO 決裁 2026-08-02)。
//
// ## なぜこの契約が要るのか
//
// 撤去した `checkAndGrantFixedIntervalReward` は `totalRecords % 5 === 0` で発火していた。
// これは「連続」でも「習慣」でもなく **記録の累計回数の剰余**で、1 日に 5 回記録しても発火する。
// 日々の記録をたくさん付けただけでポイントを配るのは褒める対象の取り違えであり、
// **親が「がんばったね」と言う前にアプリが完結させてしまう**
// (`26-ゲーミフィケーション設計書 §2.1-2`「最終的な報酬は親からの言葉」)。
//
// そして**同じ取り違えが `issueMonthlyCertificateIfEligible` にも残っていた** — 発行条件が
// 「その月の活動**回数** 10 回以上」で、1 日に 10 回記録しても達成する。呼び出し元が 0 件で
// 顧客に届いていなかったため露見していなかっただけである (#4172 Q4)。
//
// ## 本 test が固定する契約
//
//   [H1] 判定は「その月に記録した**日数**」で行う。1 日に何回記録しても 1 日と数える
//   [H2] 閾値は月 10 日 (PO 決裁 AC16)。9 日では発行しない
//   [H3] 冪等 — 同月の証明書が既にあれば再発行も再付与もしない
//   [H4] 発行に成功したときだけ 50pt を付与する (AC10)
//   [H5] **書き込み順は 証明書 → ledger** (AC18)。逆順は「記録の無いポイント」を生む
//   [H6] 通知は親のみ。**子への演出は出さない** (AC11')
//
// ## 閾値 10 の根拠と再評価トリガー (AC16 / AC17)
//
// 本番実データ (NUC 1 家庭 2 人 / 6 child-month、**n=1 なので分布ではない**) は
// 23・22 日の習慣月と 7・3・1・1 日の失速月に二分され、その谷に閾値を置く 10 日だけが
// 両者を分けた。**7 日や 31 日で褒めると親の「1 ヶ月がんばったね」が空になる** (PO 決裁)。
// n=1 で決めた値なので**動かす条件を先に決める**: 3 ヶ月連続で誰も達成しなければ 10 → 8 に下げる。
// 定数と再評価トリガーの SSOT は `src/lib/domain/constants/habit-milestones.ts`。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asChildId } from '$lib/domain/ids';

vi.mock('$lib/server/db/certificate-repo', () => ({
	findCertificateById: vi.fn(),
	findCertificates: vi.fn(),
	hasCertificate: vi.fn(),
	issueCertificate: vi.fn(),
}));

vi.mock('$lib/server/db/point-repo', () => ({
	insertPointEntry: vi.fn(),
}));

vi.mock('$lib/server/services/report-service', () => ({
	getMonthlyReport: vi.fn(),
}));

vi.mock('$lib/server/services/notification-service', () => ({
	sendPushNotification: vi.fn(),
}));

vi.mock('$lib/server/services/habit-certificate-notice-service', () => ({
	recordHabitCertificateNotice: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	MONTHLY_HABIT_DAYS_THRESHOLD,
	MONTHLY_HABIT_POINTS,
	MONTHLY_HABIT_THRESHOLD_REVIEW_DEADLINE,
	MONTHLY_HABIT_THRESHOLD_REVIEW_MIN_PAID_FAMILIES,
	MONTHLY_HABIT_THRESHOLD_REVIEW_TRIGGER,
} from '$lib/domain/constants/habit-milestones';
import { hasCertificate, issueCertificate } from '$lib/server/db/certificate-repo';
import { insertPointEntry } from '$lib/server/db/point-repo';
import { issueMonthlyHabitCertificateIfEligible } from '$lib/server/services/certificate-service';
import { recordHabitCertificateNotice } from '$lib/server/services/habit-certificate-notice-service';
import { sendPushNotification } from '$lib/server/services/notification-service';
import { getMonthlyReport } from '$lib/server/services/report-service';

const CHILD_ID = asChildId(1);
const TENANT = 't-habit';
const MONTH = '2026-03';

/** getMonthlyReport の戻りのうち、本契約が見る値だけを組み立てる。 */
function monthlyReport(daysWithActivity: number) {
	return {
		yearMonth: MONTH,
		daysWithActivity,
		totalDays: 31,
		totalActivities: daysWithActivity * 3, // 1 日 3 回記録しても「日数」で判定されること
		totalPoints: 500,
		categoryBreakdown: {},
	} as unknown as Awaited<ReturnType<typeof getMonthlyReport>>;
}

function certificateRow() {
	return {
		id: 1,
		childId: CHILD_ID,
		tenantId: TENANT,
		certificateType: `monthly_${MONTH}`,
		title: 'title',
		description: 'desc',
		issuedAt: '2026-04-01T00:00:00.000Z',
		metadata: null,
	} as unknown as Awaited<ReturnType<typeof issueCertificate>>;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(hasCertificate).mockResolvedValue(false);
	vi.mocked(issueCertificate).mockResolvedValue(certificateRow());
	vi.mocked(sendPushNotification).mockResolvedValue(
		undefined as unknown as Awaited<ReturnType<typeof sendPushNotification>>,
	);
});

describe('#4172 月間の習慣化を褒める (記録の量ではなく日数)', () => {
	it('[H1] 1 日に何回記録しても 1 日と数える — 回数が閾値を超えていても日数が足りなければ発行しない', async () => {
		// 9 日 × 3 回 = 27 回。旧条件 (活動回数 10 回以上) なら発行されてしまう。
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(9));

		const result = await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(result).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
		expect(insertPointEntry).not.toHaveBeenCalled();
	});

	it(`[H2] 閾値は月 ${MONTHLY_HABIT_DAYS_THRESHOLD} 日 — 1 日足りなければ発行しない`, async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(MONTHLY_HABIT_DAYS_THRESHOLD - 1));

		expect(await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT)).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
	});

	it(`[H2] 閾値ちょうど (${MONTHLY_HABIT_DAYS_THRESHOLD} 日) で発行する`, async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(MONTHLY_HABIT_DAYS_THRESHOLD));

		const result = await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(result).not.toBeNull();
		expect(issueCertificate).toHaveBeenCalledWith(
			expect.objectContaining({ childId: CHILD_ID, certificateType: `monthly_${MONTH}` }),
			TENANT,
		);
	});

	it('[H3] 同月に既に発行済みなら、証明書も通貨も出さない (冪等)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));
		vi.mocked(hasCertificate).mockResolvedValue(true);

		const result = await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(result).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
		// **ここが本 Issue の核** — 撤去した機構は同じ達成で二重に通貨を出していた。
		expect(insertPointEntry).not.toHaveBeenCalled();
	});

	it(`[H4] 発行できたときだけ ${MONTHLY_HABIT_POINTS}pt を付与する`, async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));

		await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(insertPointEntry).toHaveBeenCalledTimes(1);
		expect(insertPointEntry).toHaveBeenCalledWith(
			expect.objectContaining({ childId: CHILD_ID, amount: MONTHLY_HABIT_POINTS }),
			TENANT,
		);
	});

	it('[H5] 書き込み順は 証明書 → ledger (逆順は記録の無いポイントを生む)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));
		const order: string[] = [];
		vi.mocked(issueCertificate).mockImplementation(async () => {
			order.push('certificate');
			return certificateRow();
		});
		vi.mocked(insertPointEntry).mockImplementation(async () => {
			order.push('ledger');
			return undefined as unknown as ReturnType<typeof insertPointEntry>;
		});

		await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(order).toEqual(['certificate', 'ledger']);
	});

	it('[H6] 通知は親のみに送る — 子への演出を出す経路を呼ばない', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));

		await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		// Web Push は subscribe が child role を 403 で拒否するため構造的に親のみ (#1593)。
		expect(sendPushNotification).toHaveBeenCalledTimes(1);
		const [, notificationType] = vi.mocked(sendPushNotification).mock.calls[0] ?? [];
		expect(notificationType).toBe('monthly_habit');
	});

	it('[H6] 通知に失敗しても証明書と通貨は取り消さない (通知は付帯物)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));
		vi.mocked(sendPushNotification).mockRejectedValue(new Error('push failed'));

		const result = await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(result).not.toBeNull();
		expect(insertPointEntry).toHaveBeenCalledTimes(1);
	});

	// #4261 ③: AC11' の「子への演出は出さない」は維持したまま、Push が届かない家庭でも
	// 子が残高の増えた理由を知れるようにする (PO 決裁 2026-08-06)。
	it('[H7] 発行時に「次回起動で 1 回だけ」の pending を残す (Push の可否に関わらず 1 件)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));

		await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(recordHabitCertificateNotice).toHaveBeenCalledTimes(1);
		expect(recordHabitCertificateNotice).toHaveBeenCalledWith(
			{ childId: CHILD_ID, yearMonth: MONTH, points: MONTHLY_HABIT_POINTS },
			TENANT,
		);
	});

	it('[H7] 発行しなかった月は pending を残さない (残高が動いていないのに告知しない)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(MONTHLY_HABIT_DAYS_THRESHOLD - 1));

		await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(recordHabitCertificateNotice).not.toHaveBeenCalled();
	});

	it('[H7] 告知の保存に失敗しても証明書と通貨は取り消さない (告知は付帯物)', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(monthlyReport(20));
		vi.mocked(recordHabitCertificateNotice).mockRejectedValue(new Error('kv failed'));

		const result = await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT);

		expect(result).not.toBeNull();
		expect(insertPointEntry).toHaveBeenCalledTimes(1);
		// 告知が落ちても親への Push は送る (2 経路が相互に道連れにならない)
		expect(sendPushNotification).toHaveBeenCalledTimes(1);
	});

	it('月次レポートが取れない月は何もしない', async () => {
		vi.mocked(getMonthlyReport).mockResolvedValue(null);

		expect(await issueMonthlyHabitCertificateIfEligible(CHILD_ID, MONTH, TENANT)).toBeNull();
		expect(issueCertificate).not.toHaveBeenCalled();
		expect(insertPointEntry).not.toHaveBeenCalled();
	});
});

// #4261 ② — 「n=1 のまま据え置くのは構わないが、いつ見直すかが無いまま固定するのは認めない」
// (PO 決裁 2026-08-06)。トリガーが本文から静かに消えたら赤にする。
describe('#4261 ② 閾値 10 日の再評価トリガー', () => {
	it('[H8] 期日と、期日より早く再評価に入る条件の両方が残っている', () => {
		expect(MONTHLY_HABIT_THRESHOLD_REVIEW_DEADLINE).toBe('2026-11-05');
		expect(MONTHLY_HABIT_THRESHOLD_REVIEW_MIN_PAID_FAMILIES).toBe(3);
		expect(MONTHLY_HABIT_THRESHOLD_REVIEW_TRIGGER).toContain(
			MONTHLY_HABIT_THRESHOLD_REVIEW_DEADLINE,
		);
		expect(MONTHLY_HABIT_THRESHOLD_REVIEW_TRIGGER).toContain(
			String(MONTHLY_HABIT_THRESHOLD_REVIEW_MIN_PAID_FAMILIES),
		);
	});
});
