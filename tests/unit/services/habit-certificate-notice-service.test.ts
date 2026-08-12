// tests/unit/services/habit-certificate-notice-service.test.ts
//
// #4261 ③ — Push が届かない家庭で「褒める体験が完全に無音」になるのを止める。
//
// ## なぜこの契約が要るのか
//
// #4172 AC11' により、月間の習慣化証明書は**親への Web Push のみ**で伝える設計になっている
// (子への演出を出すと子の中で完結し、親が「1 ヶ月続いたね」と言う前にアプリが言ってしまう)。
// ところが `/api/v1/notifications/subscribe` を許可していない家庭では Push が 1 通も届かず、
// **子は残高が 50pt 増えた理由を知る手段が無い**。仕組みが動いていても伝わっていなければ
// 褒める機構は成立していない (PO 決裁 2026-08-06)。
//
// ## 本 test が固定する契約
//
//   [N1] 発行時に「次回起動で 1 回だけ伝える」pending を残す
//   [N2] 壊れた値 / 空 / 未設定は null に倒す (画面が落ちない)
//   [N3] 既読化すると消え、二度と出ない
//   [N4] Push の可否に関わらず pending は 1 件 (届いた家庭だけ二重に演出しない)
//
// ADR-0012 との両立条件 (1 回だけ / 演出を足さない / 閉じる操作を挟まない) のうち、
// 「1 回だけ」を保証するのが本 service。表示側の条件は
// `tests/unit/features/habit-certificate-notice.test.ts` が持つ。

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asChildId } from '$lib/domain/ids';

const settingsStore = new Map<string, string>();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		settings: {
			getSetting: async (key: string) => settingsStore.get(key),
			setSetting: async (key: string, value: string) => {
				settingsStore.set(key, value);
			},
		},
	}),
}));

import {
	clearHabitCertificateNotice,
	getHabitCertificateNotice,
	habitCertificateNoticeKey,
	recordHabitCertificateNotice,
} from '$lib/server/services/habit-certificate-notice-service';

const CHILD_ID = asChildId('11111111-1111-4111-8111-111111111111');
const TENANT = 't-habit-notice';
const KEY = habitCertificateNoticeKey(CHILD_ID);

beforeEach(() => {
	settingsStore.clear();
});

describe('#4261 ③ 習慣化証明書の「次回起動で 1 回だけ」告知', () => {
	it('[N1] 記録すると、次回起動で読み出せる', async () => {
		await recordHabitCertificateNotice(
			{ childId: CHILD_ID, yearMonth: '2026-08', points: 50 },
			TENANT,
		);

		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toEqual({
			yearMonth: '2026-08',
			points: 50,
		});
	});

	it('[N2] 未設定なら null', async () => {
		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toBeNull();
	});

	it.each([
		['空文字 (既読の表現)', ''],
		['JSON でない', 'not-json'],
		['yearMonth が形式外', '{"yearMonth":"2026/08","points":50}'],
		['points が数値でない', '{"yearMonth":"2026-08","points":"50"}'],
		['points が負', '{"yearMonth":"2026-08","points":-1}'],
		['配列', '[]'],
	])('[N2] 壊れた値 (%s) は null に倒す — 画面を落とさない', async (_name, raw) => {
		settingsStore.set(KEY, raw);

		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toBeNull();
	});

	it('[N3] 既読化すると消え、二度と出ない', async () => {
		await recordHabitCertificateNotice(
			{ childId: CHILD_ID, yearMonth: '2026-08', points: 50 },
			TENANT,
		);
		await clearHabitCertificateNotice(CHILD_ID, TENANT);

		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toBeNull();
		// 既読化を 2 回踏んでも復活しない (多重 POST された場合)
		await clearHabitCertificateNotice(CHILD_ID, TENANT);
		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toBeNull();
	});

	it('[N4] 同じ月を 2 回記録しても pending は 1 件 (キーが月ではなく子で 1 本)', async () => {
		await recordHabitCertificateNotice(
			{ childId: CHILD_ID, yearMonth: '2026-08', points: 50 },
			TENANT,
		);
		await recordHabitCertificateNotice(
			{ childId: CHILD_ID, yearMonth: '2026-09', points: 50 },
			TENANT,
		);

		// 最後に達成した月だけを伝える。溜めて連続表示しない (ADR-0012)。
		expect(await getHabitCertificateNotice(CHILD_ID, TENANT)).toEqual({
			yearMonth: '2026-09',
			points: 50,
		});
		expect([...settingsStore.keys()]).toEqual([KEY]);
	});

	it('キーは子ごとに分かれる — 兄弟の告知が混ざらない', () => {
		const sibling = asChildId('22222222-2222-4222-8222-222222222222');

		expect(habitCertificateNoticeKey(CHILD_ID)).not.toBe(habitCertificateNoticeKey(sibling));
		expect(habitCertificateNoticeKey(CHILD_ID)).toContain(CHILD_ID);
	});
});
