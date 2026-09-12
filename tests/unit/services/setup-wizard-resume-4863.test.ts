// tests/unit/services/setup-wizard-resume-4863.test.ts
//
// 中断した親の「続きをする」が **ウィザードへ戻る**ことを固定する (#4863 / PO 決裁 2026-09-09)。
//
// 経緯: #2821 は「続きは admin の OnboardingChecklist に寄せる」と決めたが、**当時は
// step 2〜9 が原理的に開かなかった**。あのときウィザードへ戻していたら親を行き止まりに
// 送っていたので、admin へ逃がしたのは正しい実装ではなく壊れたものを避ける迂回だった。
// #4863 で step 2〜9 が開いた以上、前提が変わっている。
//
// なぜ admin のままではいけないか (実測): checklist は 6 項目、ウィザードは 9 step で、
// **questionnaire / rules / activities-defaults / challenges / first-adventure の 5 つに
// checklist の対応が無い**。とりわけ first-adventure (親子で最初の 1 件を記録する) は
// このプロダクトのコアループそのもので、step 2〜9 が開かなかった間、一度も誰にも届いていない。
//
// 固定する不変条件:
//   [R1] `getOnboardingProgress` が印を読んで `wizardInProgress` を返す
//   [R2] 印が無ければ false (既存テナント / 歩き終えた人の挙動は変わらない)
//   [R3] 印の読み取りが失敗しても progress 自体は返る (バナーが消えるだけにしない)

import { beforeEach, describe, expect, it, vi } from 'vitest';

let settings: Map<string, string> = new Map();
/** この key の読み取りだけを失敗させる (印の読み取り失敗を単独で再現するため)。 */
let throwOnKey: string | null = null;

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: vi.fn(async (key: string, tenantId: string) => {
		if (throwOnKey === key) throw new Error('settings unavailable');
		return settings.get(`${tenantId}:${key}`);
	}),
	setSetting: vi.fn(async (key: string, value: string, tenantId: string) => {
		settings.set(`${tenantId}:${key}`, value);
	}),
	getSettings: vi.fn(async () => ({})),
}));

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(async () => [{ id: 'c-1', nickname: 'まさと', age: 7 }]),
	getArchivedChildren: vi.fn(async () => []),
}));
vi.mock('$lib/server/services/activity-service', () => ({ getActivities: vi.fn(async () => []) }));
// #4910: rewards の完了判定は per-child reward (`getChildSpecialRewards`) を見る。
vi.mock('$lib/server/services/special-reward-service', () => ({
	getChildSpecialRewards: vi.fn(async () => ({ rewards: [], totalPoints: 0 })),
}));
vi.mock('$lib/server/db/checklist-repo', () => ({ findTemplatesByChild: vi.fn(async () => []) }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getOnboardingProgress } = await import(
	'../../../src/lib/server/services/onboarding-service'
);

beforeEach(() => {
	settings = new Map();
	throwOnKey = null;
	vi.clearAllMocks();
});

describe('[R1][R2][R3] 再開バナーの行き先を決める印', () => {
	it('[R1] 印が立っていれば wizardInProgress = true', async () => {
		settings.set('t-1:setup_wizard_in_progress', 'true');
		const p = await getOnboardingProgress('t-1', '/admin');
		expect(
			p.wizardInProgress,
			'中断者を admin の checklist へ送ると、checklist に対応の無い 5 step が二度と届かない',
		).toBe(true);
	});

	it('[R2] 印が無ければ false (既存テナントの挙動は変えない)', async () => {
		const p = await getOnboardingProgress('t-1', '/admin');
		expect(p.wizardInProgress).toBe(false);
	});

	it('[R2] 歩き終えた人 (印が false) も false', async () => {
		settings.set('t-1:setup_wizard_in_progress', 'false');
		expect((await getOnboardingProgress('t-1', '/admin')).wizardInProgress).toBe(false);
	});

	it('[R3] 印だけが読めなくても checklist は返る', async () => {
		throwOnKey = 'setup_wizard_in_progress';
		const p = await getOnboardingProgress('t-1', '/admin');
		expect(p.wizardInProgress, '読めないときは「歩いていない」に倒す (fail-closed)').toBe(false);
		expect(Array.isArray(p.items), '印が読めないだけで checklist ごと消してはいけない').toBe(true);
	});
});
