// tests/unit/services/onboarding-wizard-in-progress-4868.test.ts
//
// **ウィザードを歩いている間は「セットアップ完了」と言わない**ことを固定する
// (#4868 adversarial round 4)。
//
// なぜ service 側なのか: admin の checklist が持つ required 5 項目 (children /
// activities / rewards / checklist / child_screen) は、ウィザードの step 1〜4 と
// `/switch` で埋まってしまう。つまり後半 5 step (rules / activities-defaults /
// challenges / **first-adventure** / complete) を歩き終える前に `allCompleted` が立つ。
//
// その状態で `/admin` に着くと `OnboardingChecklist` / `AdminHome` が
// 🎉「すべてのセットアップが完了しました！」と**「非表示にする」**を描く。押すと
// `onboarding_dismissed` が立ち、**解除する経路は src に無い**。`SetupResumeBanner` は
// `/setup/questionnaire` への唯一のリンクなので、そこで戻り道が永久に閉じる
// (= この PR が「一度も誰にも届いていない」と名指しした first-adventure が、
// この PR の出口を使った親にだけ二度と届かなくなる)。
//
// バナー側だけで条件を足すと admin の「完了しました」が残り、**同時刻に 2 つの画面が
// 正反対を言う**。判定は 1 箇所に置く。
//
// 固定する不変条件:
//   [O1] required が全部埋まっていても、印が立っている間は allCompleted=false
//   [O2] 印が降りたら allCompleted=true (歩き終えた人には出し続けない)
//   [O3] 印は返り値にそのまま出る (バナーの行き先分岐が読む)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
	wizardInProgress: false,
	settings: new Map<string, string>(),
};

vi.mock('$lib/server/services/setup-service', () => ({
	isSetupWizardInProgress: vi.fn(async () => state.wizardInProgress),
}));

vi.mock('$lib/server/db/settings-repo', () => ({
	getSetting: vi.fn(async (key: string) => state.settings.get(key) ?? null),
	setSetting: vi.fn(async (key: string, value: string) => {
		state.settings.set(key, value);
	}),
}));

// required 5 項目がすべて埋まる状態を作る
vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: vi.fn(async () => [{ id: 'c-1', nickname: 'まさと' }]),
}));
vi.mock('$lib/server/services/activity-service', () => ({
	getActivities: vi.fn(async () => [{ id: 'a-1', name: 'はみがき' }]),
}));
// #4910: rewards の完了判定は per-child reward (`getChildSpecialRewards`) を見る。
vi.mock('$lib/server/services/special-reward-service', () => ({
	getChildSpecialRewards: vi.fn(async () => ({
		rewards: [{ id: 'r-1', title: 'ごほうび', points: 10 }],
		totalPoints: 10,
	})),
}));
vi.mock('$lib/server/db/checklist-repo', () => ({
	findTemplatesByChild: vi.fn(async () => [{ id: 't-1', name: 'あさのしたく' }]),
}));

const { getOnboardingProgress } = await import(
	'../../../src/lib/server/services/onboarding-service'
);

beforeEach(() => {
	state.wizardInProgress = false;
	state.settings = new Map<string, string>([
		['onboarding_child_screen_visited', 'true'],
		['parent_pin_hash', 'x'],
	]);
	vi.clearAllMocks();
});

describe('[O1][O2] 印が立っている間は完了と言わない', () => {
	it('required が全部埋まっていても、印が立っていれば allCompleted=false', async () => {
		state.wizardInProgress = true;

		const progress = await getOnboardingProgress('t-1', '/admin');

		expect(
			progress.items.filter((i) => i.required).every((i) => i.completed),
			'前提が崩れている (required が埋まっていない状態を測っている)',
		).toBe(true);
		expect(
			progress.allCompleted,
			'ウィザードの後半 5 step を歩き終える前に「完了しました」と言うと、' +
				'admin の「非表示にする」を押した親の戻り道が永久に閉じる',
		).toBe(false);
	});

	it('印が降りていれば allCompleted=true (歩き終えた人には出し続けない)', async () => {
		state.wizardInProgress = false;

		const progress = await getOnboardingProgress('t-1', '/admin');

		expect(progress.allCompleted).toBe(true);
	});
});

describe('[O3] 印は返り値に出る', () => {
	it('wizardInProgress がそのまま返る (バナーの行き先分岐が読む)', async () => {
		state.wizardInProgress = true;
		expect((await getOnboardingProgress('t-1', '/admin')).wizardInProgress).toBe(true);

		state.wizardInProgress = false;
		expect((await getOnboardingProgress('t-1', '/admin')).wizardInProgress).toBe(false);
	});
});
