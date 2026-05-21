// tests/unit/tutorial/page-guide-store.test.ts
// #2375 (EPIC #2362 P4): startPageGuide 冪等 guard + 異 pageId 切替動作の検証
//
// AC-V2-1: active 中の同一 pageId 再起動は no-op
// AC-V2-2: 異 pageId 切替時は endPageGuide() を先行実行 (state 完全 reset)
//
// 旧実装は `startPageGuide` を呼ぶたびに無条件で state を上書きしていたため、❓ 連打で
// bubble appear アニメが 2 回連続再生され、PO 直接指摘の「2 つのダイアログが重複起動」
// 症状の根因 (A + D) の一翼を担っていた。本テストは冪等 guard の構造的維持を保証する。

import { afterEach, describe, expect, it } from 'vitest';
import type { PageGuide } from '../../../src/lib/ui/tutorial/page-guide-types';
import {
	endPageGuide,
	getCurrentGuideInfo,
	getGuideProgress,
	isPageGuideActive,
	nextGuideStep,
	startPageGuide,
} from '../../../src/lib/ui/tutorial/page-guide-store.svelte';

// 最小 fixture (admin-activities / admin-rewards 2 ガイドのみで冪等性 / 切替を検証)
const ACTIVITIES_GUIDE: PageGuide = {
	pageId: 'admin-activities',
	title: '活動管理',
	icon: '📋',
	steps: [
		{
			id: 'a1',
			title: 'a1',
			what: '何ができる？',
			how: 'やり方',
			goal: 'ゴール',
		},
		{
			id: 'a2',
			title: 'a2',
			what: '何ができる？',
			how: 'やり方',
			goal: 'ゴール',
		},
	],
};

const REWARDS_GUIDE: PageGuide = {
	pageId: 'admin-rewards',
	title: 'ごほうび',
	icon: '🎁',
	steps: [
		{
			id: 'r1',
			title: 'r1',
			what: '何ができる？',
			how: 'やり方',
			goal: 'ゴール',
		},
	],
};

describe('page-guide-store startPageGuide #2375', () => {
	afterEach(() => {
		endPageGuide();
	});

	it('AC-V2-1: active 中の同一 pageId 再起動は no-op (state を上書きしない)', () => {
		startPageGuide(ACTIVITIES_GUIDE);
		// step を 1 つ進めた状態で、同じ pageId で再 start を呼ぶ
		nextGuideStep();
		expect(getGuideProgress()).toEqual({ current: 2, total: 2 });

		// 同一 pageId で再起動 → no-op、currentStepIndex は維持される
		startPageGuide(ACTIVITIES_GUIDE);

		expect(isPageGuideActive()).toBe(true);
		expect(getCurrentGuideInfo()?.pageId).toBe('admin-activities');
		expect(getGuideProgress()).toEqual({ current: 2, total: 2 });
	});

	it('AC-V2-2: 異 pageId 切替時は state を完全 reset (currentStepIndex = 0)', () => {
		startPageGuide(ACTIVITIES_GUIDE);
		nextGuideStep();
		expect(getGuideProgress()).toEqual({ current: 2, total: 2 });

		// 異 pageId で start → 旧 state は endPageGuide() で reset され、新 guide は step 0 から
		startPageGuide(REWARDS_GUIDE);

		expect(isPageGuideActive()).toBe(true);
		expect(getCurrentGuideInfo()?.pageId).toBe('admin-rewards');
		expect(getGuideProgress()).toEqual({ current: 1, total: 1 });
	});

	it('未起動状態からの startPageGuide は新規起動として動作する', () => {
		expect(isPageGuideActive()).toBe(false);

		startPageGuide(ACTIVITIES_GUIDE);

		expect(isPageGuideActive()).toBe(true);
		expect(getCurrentGuideInfo()?.pageId).toBe('admin-activities');
		expect(getGuideProgress()).toEqual({ current: 1, total: 2 });
	});
});
