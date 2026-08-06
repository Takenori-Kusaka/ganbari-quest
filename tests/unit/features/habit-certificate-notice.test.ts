// tests/unit/features/habit-certificate-notice.test.ts
//
// #4261 ③ — 表示側の契約。ADR-0012 (anti-engagement) との両立条件を固定する。
//
// PO 決裁 (2026-08-06) の 3 条件:
//   1 回だけ。既読で消える / 演出を足さない / 閉じる操作を挟まない
//
// 「1 回だけ」の保存側は habit-certificate-notice-service が持つ。本 test は
// **いつ出すか / いつ出さないか**を固定する。
//
//   [D1] pending があれば出す
//   [D2] 誕生日ボーナス未受取の回は出さない (演出を 2 枚重ねない) — かつ pending は消さない
//   [D3] `?screenshot=*` では出さない (visual regression baseline を日付依存にしない)
//   [D4] 文言は 5 年齢モードすべてで成立する (baby は子供向け画面を持たないため対象外)

import { describe, expect, it } from 'vitest';

import {
	getHabitCertificateNoticeText,
	shouldShowHabitCertificateNotice,
} from '$lib/features/child-home/habit-certificate-notice';

const notice = { yearMonth: '2026-08', points: 50 };

describe('#4261 ③ 習慣化告知の表示条件', () => {
	it('[D1] pending があれば出す', () => {
		expect(
			shouldShowHabitCertificateNotice({
				notice,
				birthdayPending: false,
				isScreenshotMode: false,
			}),
		).toBe(true);
	});

	it('[D1] pending が無ければ出さない', () => {
		expect(
			shouldShowHabitCertificateNotice({
				notice: null,
				birthdayPending: false,
				isScreenshotMode: false,
			}),
		).toBe(false);
	});

	it('[D2] 誕生日ボーナス未受取の回は出さない (演出を 2 枚重ねない)', () => {
		expect(
			shouldShowHabitCertificateNotice({
				notice,
				birthdayPending: true,
				isScreenshotMode: false,
			}),
		).toBe(false);
	});

	it('[D3] screenshot モードでは出さない', () => {
		expect(
			shouldShowHabitCertificateNotice({
				notice,
				birthdayPending: false,
				isScreenshotMode: true,
			}),
		).toBe(false);
	});
});

describe('#4261 ③ 告知文言 (5 年齢モード)', () => {
	// baby は親向けの準備モードで子供向けホームを持たない (ADR-0011)。
	const childModes = ['preschool', 'elementary', 'junior', 'senior'] as const;

	it.each(childModes)('[D4] %s の文言が空でなく、受け取った量を含む', (uiMode) => {
		const text = getHabitCertificateNoticeText(uiMode, '50ポイント');

		expect(text.title.length).toBeGreaterThan(0);
		expect(text.body).toContain('50ポイント');
	});

	it('[D4] preschool はひらがな中心 — 漢字を含めない', () => {
		const { title, body } = getHabitCertificateNoticeText('preschool', '50ポイント');

		// 量の表記 (引数) を除いた地の文に漢字が無いこと
		const plain = `${title}${body}`.replace('50ポイント', '');
		expect(plain).not.toMatch(/[一-龯]/);
	});

	it('[D4] 演出語 (紙吹雪・音・連打を促す語) を含めない — ADR-0012', () => {
		for (const uiMode of childModes) {
			const { title, body } = getHabitCertificateNoticeText(uiMode, '50ポイント');
			expect(`${title}${body}`).not.toMatch(/もっと|つづけて|あと[0-9０-９]/);
		}
	});
});
