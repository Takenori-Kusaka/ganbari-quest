// tests/unit/tutorial/child-guide-followups-5006.test.ts
//
// 子供の ❓ ガイド (#4864 / PR #5006) の QM follow-up。固定する不変条件:
//   [I] 章のアイコンは、同じ画面を指す下ナビ / CharacterTabs と同じ定数から引く
//   [B] 吹き出しのボタンは本文と同じ年齢帯 variant (baby / preschool / elementary = ひらがな)
//   [E] 1 step だけの章 (チェックリストが空) で、見出しと閉じるボタンが重複しない
//   [P] ショップの「主役があるか」は、全ごほうびではなく描かれているカードで決める
//   [C] `tutorial_completed_at` はホームのツアーを見終えたときだけ書く
//   [X] 終了確認を開いたまま画面が変わったら、終了確認も一緒に下ろす

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
globalThis.fetch = fetchMock as unknown as typeof fetch;

import { getChildStatusIcon, ICON_CHECKLIST } from '../../../src/lib/domain/icons';
import { getChildTutorialLabels } from '../../../src/lib/domain/labels';
import TutorialBubble from '../../../src/lib/ui/components/TutorialBubble.svelte';
import {
	getChildGuideChapters,
	getChildTutorialProgressScope,
	makeChildChapterBuilder,
	resolveShopGuidePresence,
} from '../../../src/lib/ui/tutorial/tutorial-chapters-child';
import {
	cancelExit,
	getShowExitConfirm,
	handleOverlayClick,
} from '../../../src/lib/ui/tutorial/tutorial-step-controller.svelte';
import {
	endTutorial,
	getCurrentStep,
	isTutorialActive,
	nextStep,
	setChapters,
	setChildChapterBuilder,
	setChildGuidePage,
	setChildGuidePresence,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';
import type { TutorialChapter } from '../../../src/lib/ui/tutorial/tutorial-types';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MODES = ['preschool', 'elementary', 'junior', 'senior'] as const;
const KANA_MODES = ['baby', 'preschool', 'elementary'] as const;
const KANJI_MODES = ['junior', 'senior'] as const;
const KANJI = /\p{Script=Han}/u;

describe('[I] 章のアイコンは画面と同じ定数', () => {
	it('つよさ / ステータスの章は CharacterTabs のタブと同じアイコン (幼児・小学生 ⭐ / 中高生 📊)', () => {
		for (const uiMode of MODES) {
			for (const presence of [true, false, undefined]) {
				expect(getChildGuideChapters('status', uiMode, presence)[0]?.icon, uiMode).toBe(
					getChildStatusIcon(uiMode),
				);
			}
		}
	});

	it('CharacterTabs のつよさタブは getChildStatusIcon から引く (アイコンの直書きを持たない)', () => {
		const source = readFileSync(
			join(REPO_ROOT, 'src/lib/features/character/CharacterTabs.svelte'),
			'utf8',
		);
		for (const uiMode of ['baby', ...MODES]) {
			expect(source, uiMode).toContain(`getChildStatusIcon('${uiMode}')`);
		}
		expect(source).not.toContain("'📊'");
	});

	it('チェックリストの章は下ナビと同じ ICON_CHECKLIST', () => {
		for (const uiMode of MODES) {
			for (const presence of [true, false, undefined]) {
				expect(getChildGuideChapters('checklist', uiMode, presence)[0]?.icon, uiMode).toBe(
					ICON_CHECKLIST,
				);
			}
		}
	});
});

describe('[B] 吹き出しのボタンは本文と同じ年齢帯 variant', () => {
	const keys = ['bubbleEnd', 'bubblePrev', 'bubbleNext', 'bubbleDone'] as const;

	it('baby / preschool / elementary はひらがな (本文がひらがななのにボタンだけ漢字、を作らない)', () => {
		for (const uiMode of KANA_MODES) {
			const dialog = getChildTutorialLabels(uiMode).dialog;
			for (const key of keys) {
				expect(dialog[key], `${uiMode}.${key}`).toBeTruthy();
				expect(KANJI.test(dialog[key]), `${uiMode}.${key}: 「${dialog[key]}」`).toBe(false);
			}
		}
	});

	it('junior / senior は漢字', () => {
		for (const uiMode of KANJI_MODES) {
			const dialog = getChildTutorialLabels(uiMode).dialog;
			for (const key of keys) {
				expect(KANJI.test(dialog[key]), `${uiMode}.${key}: 「${dialog[key]}」`).toBe(true);
			}
		}
	});
});

function oneChapter(stepCount: number): TutorialChapter[] {
	return [
		{
			id: 1,
			title: 'しょう',
			icon: '⭐',
			steps: Array.from({ length: stepCount }, (_, i) => ({
				id: `s${i + 1}`,
				chapterId: 1,
				title: `たいとる${i + 1}`,
				description: 'せつめい',
				position: 'bottom' as const,
			})),
		},
	];
}

// jsdom は Web Animations API を持たない (吹き出しの出現演出が呼ぶ)。表示の検証には不要なので空実装を置く
if (typeof Element.prototype.getAnimations !== 'function') {
	Element.prototype.getAnimations = () => [];
}
if (typeof Element.prototype.animate !== 'function') {
	Element.prototype.animate = (() => ({ cancel() {} })) as unknown as Element['animate'];
}

async function renderBubble(stepCount: number, childUiMode: string) {
	setChapters(oneChapter(stepCount));
	await startTutorial();
	const step = getCurrentStep();
	if (!step) throw new Error('step が無い');
	return render(TutorialBubble, { step, targetRect: null, animKey: 0, childUiMode });
}

describe('[E] 1 step だけの章', () => {
	beforeEach(() => {
		endTutorial();
		localStorage.clear();
	});
	afterEach(() => {
		cleanup();
		endTutorial();
	});

	it('チェックリストが空の章は、章の見出しと step の見出しが同じ語にならない', () => {
		for (const uiMode of MODES) {
			const [chapter] = getChildGuideChapters('checklist', uiMode, false);
			expect(chapter?.steps).toHaveLength(1);
			expect(chapter?.steps[0]?.title, uiMode).not.toBe(chapter?.title);
		}
	});

	it('1 step だけなら閉じるボタンは 1 つ (「おわり」と「おしまい！」を並べない)', async () => {
		const { container } = await renderBubble(1, 'preschool');
		expect(container.querySelector('.tutorial-nav-end')).toBeNull();
		expect(container.querySelector('.tutorial-nav-next')?.textContent?.trim()).toBe('おしまい！');
	});

	it('2 step 以上なら途中で閉じる「おわり」を出す。小学生のボタンもひらがな', async () => {
		const { container } = await renderBubble(2, 'elementary');
		expect(container.querySelector('.tutorial-nav-end')?.textContent?.trim()).toBe('おわり');
		expect(container.querySelector('.tutorial-nav-next')?.textContent?.trim()).toBe('つぎへ');
	});

	it('中学生は漢字のボタン', async () => {
		const { container } = await renderBubble(2, 'junior');
		expect(container.querySelector('.tutorial-nav-end')?.textContent?.trim()).toBe('終了');
		expect(container.querySelector('.tutorial-nav-next')?.textContent?.trim()).toBe('次へ');
	});
});

describe('[P] ショップの「主役があるか」は描かれているカードで決める', () => {
	it('ごほうびが 1 つも無い → false (「まだ ないよ」)', () => {
		expect(resolveShopGuidePresence(0, 0)).toBe(false);
	});

	it('今のタブにカードが描かれている → true (カードを指す)', () => {
		expect(resolveShopGuidePresence(5, 2)).toBe(true);
	});

	it('ごほうびはあるが今のタブ / 絞り込みでは 0 枚 → undefined (指さないが「無い」とも言わない)', () => {
		expect(resolveShopGuidePresence(5, 0)).toBeUndefined();
		const steps = getChildGuideChapters('shop', 'preschool', resolveShopGuidePresence(5, 0))[0]
			?.steps;
		expect(steps?.[0]?.id).toBe('child-shop-exchange');
		expect(steps?.[0]?.selector).toBeUndefined();
	});

	it('ショップ画面は描かれているカード (タブ + 絞り込み) の件数を渡す', () => {
		const source = readFileSync(
			join(REPO_ROOT, 'src/routes/(child)/[uiMode=uiMode]/shop/+page.svelte'),
			'utf8',
		);
		expect(source).toContain('applyFilters(rewardsForTab(activeTabRaw)).length');
		expect(source).toContain('resolveShopGuidePresence(');
	});
});

describe('[C] / [X] store', () => {
	const SCOPE = getChildTutorialProgressScope('c-1', 'elementary');

	function tutorialPosts(): number {
		return fetchMock.mock.calls.filter(([url]) => String(url) === '/api/v1/settings/tutorial')
			.length;
	}

	async function finishGuide() {
		await startTutorial();
		for (let i = 0; i < 10 && isTutorialActive(); i++) await nextStep();
		expect(isTutorialActive()).toBe(false);
	}

	beforeEach(() => {
		endTutorial();
		setChapters([]);
		localStorage.clear();
		setChildChapterBuilder(makeChildChapterBuilder('elementary'), SCOPE);
		cancelExit();
		fetchMock.mockClear();
	});

	it('[C] ホーム以外のガイドを見終えても tutorial_completed_at を書かない', async () => {
		for (const page of ['checklist', 'shop', 'status']) {
			setChildGuidePage(page);
			setChildGuidePresence(page, true);
			await finishGuide();
		}
		expect(tutorialPosts()).toBe(0);
	});

	it('[C] ホームのツアーを見終えたら書く', async () => {
		setChildGuidePage('home');
		setChildGuidePresence('home', true);
		await finishGuide();
		expect(tutorialPosts()).toBe(1);
	});

	it('[X] 終了確認を開いたまま画面が変わったら (ブラウザの戻る)、終了確認も下ろす', async () => {
		setChildGuidePage('status');
		setChildGuidePresence('status', true);
		await startTutorial();

		const target = document.createElement('div');
		target.className = 'tutorial-overlay-bg';
		const ev = new MouseEvent('click');
		Object.defineProperty(ev, 'target', { value: target });
		handleOverlayClick(ev);
		expect(getShowExitConfirm()).toBe(true);

		setChildGuidePage('checklist');
		expect(isTutorialActive()).toBe(false);
		expect(getShowExitConfirm()).toBe(false);

		// 次に ❓ を押したとき、いきなり終了確認が開かない
		setChildGuidePresence('checklist', true);
		await startTutorial();
		expect(isTutorialActive()).toBe(true);
		expect(getShowExitConfirm()).toBe(false);
	});
});
