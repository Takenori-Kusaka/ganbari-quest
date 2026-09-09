// tests/unit/components/setup-resume-banner-4868.test.ts
//
// 再開バナーの**描画そのもの**を固定する (#4868 adversarial 実測)。
//
// なぜ必要か (2 つとも実測で見つかった):
//
// ① `allCompleted` がバナーを黙って消していた。ウィザードを歩くと step 1〜4 で
//    admin checklist の required 5 項目のうち 4 つが埋まり、この PR が足した
//    「あとでやる」で `/switch` に降りて子供の画面を 1 回覗くと
//    `markChildScreenVisited` が最後の 1 項目を埋める。→ `allCompleted = true` →
//    **バナーが二度と出ない**。印 (`wizardInProgress`) は `/setup/complete` の load で
//    しか降りないので立ったまま残り、rules / activities-defaults / challenges /
//    **first-adventure** / complete の 5 step が URL 直打ちだけのものに戻る。
//    PR が塞いだはずの行き止まりを、PR が足した出口が作り直していた。
//
// ② 本文の分岐に assertion が 1 つも無かった。story は CTA の `href` しか見ないので、
//    「行き先だけ直して本文を置き去りにする」= round 2 が捕まえた欠陥そのものの
//    revert が緑のまま通った。
//
// **story ではなく unit に置く理由**: `storybook-test` は重量レーン job で
// base==main / release/* 限定 (branch-strategy §4)。develop 宛 PR では走らないので、
// story だけでは develop に入る時点の保証が 0 になる。`unit-test` は毎回走る。

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { SETUP_RESUME_LABELS } from '../../../src/lib/domain/labels';
import SetupResumeBanner from '../../../src/lib/features/admin/components/SetupResumeBanner.svelte';
import type {
	OnboardingItem,
	OnboardingProgress,
} from '../../../src/lib/server/services/onboarding-service';

const items: OnboardingItem[] = [
	{
		key: 'children',
		label: '子供を登録する',
		completed: true,
		href: '/admin/children',
		required: true,
	},
	{
		key: 'activities',
		label: '活動を追加する',
		completed: false,
		href: '/admin/activities',
		required: true,
	},
];

const base: OnboardingProgress = {
	items,
	completedCount: 1,
	totalCount: 5,
	allCompleted: false,
	dismissed: false,
	nextRecommendation: items[1] ?? null,
	wizardInProgress: false,
};

const banner = () => screen.queryByTestId('setup-resume-banner');
const cta = () => screen.getByTestId('setup-resume-cta');

describe('[B1] 印が立っている間は、完了扱いになってもバナーを出す', () => {
	afterEach(cleanup);

	it('allCompleted でも wizardInProgress ならバナーが出て、行き先はウィザード', () => {
		render(SetupResumeBanner, {
			onboarding: {
				...base,
				allCompleted: true,
				completedCount: 5,
				nextRecommendation: null,
				wizardInProgress: true,
			},
			variant: 'resume',
		});

		expect(
			banner(),
			'完了扱いになった瞬間にバナーが消えると、step 5〜9 が URL 直打ちだけのものに戻る',
		).not.toBeNull();
		expect(cta().getAttribute('href')).toBe('/setup/questionnaire');
	});

	it('印が無い完了済みは従来どおり描画しない (ADR-0012 進行中のみ表示)', () => {
		render(SetupResumeBanner, {
			onboarding: {
				...base,
				allCompleted: true,
				completedCount: 5,
				nextRecommendation: null,
				wizardInProgress: false,
			},
			variant: 'resume',
		});

		expect(banner(), '歩き終えた人に出し続けない').toBeNull();
	});

	it('明示的に閉じた人には出さない (印が立っていても)', () => {
		render(SetupResumeBanner, {
			onboarding: { ...base, dismissed: true, wizardInProgress: true },
			variant: 'resume',
		});

		expect(banner(), '「閉じる」を押した人に出し続けない').toBeNull();
	});
});

describe('[B2] 本文は行き先と一致する', () => {
	afterEach(cleanup);

	it('ウィザードへ戻すときは、admin checklist の進捗と項目名を出さない', () => {
		render(SetupResumeBanner, {
			onboarding: { ...base, wizardInProgress: true },
			variant: 'resume',
		});

		const text = banner()?.textContent ?? '';
		expect(text, 'ウィザードの本文が出ていない').toContain(SETUP_RESUME_LABELS.wizardResumeDesc);
		expect(
			text.includes(SETUP_RESUME_LABELS.progressText(1, 5)),
			'9 step のウィザードへ戻す人に、admin checklist 6 項目を母数にした「あと N ステップ」を出している',
		).toBe(false);
		expect(
			text.includes(SETUP_RESUME_LABELS.nextStepSuffix(items[1]?.label ?? '')),
			'「次は『活動を追加する』」と読んで押した親がアンケート画面に着く',
		).toBe(false);
	});

	it('印が無いときは従来どおり admin checklist の進捗を出す', () => {
		render(SetupResumeBanner, { onboarding: base, variant: 'resume' });

		const text = banner()?.textContent ?? '';
		expect(text).toContain(SETUP_RESUME_LABELS.progressText(1, 5));
		expect(text).not.toContain(SETUP_RESUME_LABELS.wizardResumeDesc);
	});
});
