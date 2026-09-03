// tests/unit/tutorial/tutorial-progress-per-child-4765.test.ts
// #4765 PO 回答 (2026-09-03): 子供ガイドの進捗 key は**子供ごと**に分ける。
//
// #4765 までの key は `tutorial-progress:child:<uiMode>:chapter|step` で、同じ端末・同じ年齢モードの
// 兄弟が進捗を共有していた。兄が途中まで進めると弟に「前回の途中から続けますか？」が出て、
// 弟は自分のガイドを見ないまま兄の中断位置から始まる (= 弟のガイドが飛ぶ)。
// 本 spec は「key に子供 ID が入る」「子供を切り替えると進捗が独立する」「旧 key は読まずに捨てる」
// 「子供 layout が子供 ID 付きの scope を渡す」を固定する。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
}));

globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;

import {
	getChildTutorialChapters,
	getChildTutorialProgressScope,
	getLegacyChildTutorialProgressScope,
} from '../../../src/lib/ui/tutorial/tutorial-chapters-child';
import {
	discardSavedProgress,
	endTutorial,
	getCurrentStep,
	getProgressScope,
	isResumePromptShown,
	isTutorialActive,
	nextStep,
	resumeTutorial,
	setChapters,
	startTutorial,
} from '../../../src/lib/ui/tutorial/tutorial-store.svelte';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const OLDER = 'child-older';
const YOUNGER = 'child-younger';

function useChild(childId: string, uiMode = 'preschool') {
	setChapters(getChildTutorialChapters(uiMode), getChildTutorialProgressScope(childId, uiMode));
}

describe('#4765 子供ガイドの進捗 key は子供ごと', () => {
	beforeEach(() => {
		endTutorial();
		setChapters([]);
		localStorage.clear();
		vi.clearAllMocks();
	});

	describe('scope の形', () => {
		it('scope に子供 ID が入り、別の子供は別の scope になる', () => {
			const older = getChildTutorialProgressScope(OLDER, 'preschool');
			const younger = getChildTutorialProgressScope(YOUNGER, 'preschool');
			expect(older).toContain(OLDER);
			expect(younger).toContain(YOUNGER);
			expect(older).not.toBe(younger);
		});

		it('旧 (家族共有) scope は子供 ID を含まず、新 scope と一致しない', () => {
			const legacy = getLegacyChildTutorialProgressScope('preschool');
			expect(legacy).toBe('child:preschool');
			expect(legacy).not.toBe(getChildTutorialProgressScope(OLDER, 'preschool'));
		});

		it('setChapters に渡した scope が localStorage key の namespace になる', async () => {
			useChild(OLDER);
			expect(getProgressScope()).toBe(getChildTutorialProgressScope(OLDER, 'preschool'));
			await startTutorial();
			await nextStep();
			endTutorial();
			expect(localStorage.getItem(`tutorial-progress:child:${OLDER}:preschool:chapter`)).toBe('1');
			expect(localStorage.getItem(`tutorial-progress:child:${OLDER}:preschool:step`)).toBe('1');
			// 家族共有 key には書かれない
			expect(localStorage.getItem('tutorial-progress:child:preschool:chapter')).toBeNull();
		});
	});

	describe('兄弟の独立', () => {
		it('兄が途中で中断しても、弟のガイドは resume prompt を出さず最初の step から始まる', async () => {
			// 兄: 章 1 の 2 step 目まで進めて閉じる
			useChild(OLDER);
			await startTutorial();
			await nextStep();
			expect(getCurrentStep()?.id).toBe('child-record-cancel');
			endTutorial();

			// 弟に切り替え (同じ端末・同じ年齢モード)
			useChild(YOUNGER);
			await startTutorial();
			expect(isResumePromptShown()).toBe(false);
			expect(isTutorialActive()).toBe(true);
			expect(getCurrentStep()?.id).toBe('child-record-card');
		});

		it('弟が最初から進めても兄の中断位置は残り、兄に戻ると兄の位置から再開できる', async () => {
			useChild(OLDER);
			await startTutorial();
			await nextStep();
			await nextStep(); // 章 2 の先頭
			expect(getCurrentStep()?.id).toBe('child-daily-stamp');
			endTutorial();

			useChild(YOUNGER);
			await startTutorial();
			await nextStep();
			endTutorial();

			useChild(OLDER);
			await startTutorial();
			expect(isResumePromptShown()).toBe(true);
			await resumeTutorial();
			expect(getCurrentStep()?.id).toBe('child-daily-stamp');
		});
	});

	describe('旧 key の扱い', () => {
		it('#4765 までの家族共有 key に進捗が残っていても読まない (兄の進捗が弟に付かない)', async () => {
			localStorage.setItem('tutorial-progress:child:preschool:chapter', '2');
			localStorage.setItem('tutorial-progress:child:preschool:step', '0');
			useChild(YOUNGER);
			await startTutorial();
			expect(isResumePromptShown()).toBe(false);
			expect(getCurrentStep()?.id).toBe('child-record-card');
		});

		it('discardSavedProgress は指定 scope の key だけを消し、他の子供の進捗には触れない', async () => {
			localStorage.setItem('tutorial-progress:child:preschool:chapter', '2');
			localStorage.setItem('tutorial-progress:child:preschool:step', '0');
			useChild(OLDER);
			await startTutorial();
			await nextStep();
			endTutorial();

			discardSavedProgress(getLegacyChildTutorialProgressScope('preschool'));

			expect(localStorage.getItem('tutorial-progress:child:preschool:chapter')).toBeNull();
			expect(localStorage.getItem('tutorial-progress:child:preschool:step')).toBeNull();
			expect(localStorage.getItem(`tutorial-progress:child:${OLDER}:preschool:step`)).toBe('1');
		});
	});

	describe('子供 layout の配線', () => {
		const layout = readFileSync(join(REPO_ROOT, 'src/routes/(child)/+layout.svelte'), 'utf8');

		it('setChapters には子供 ID 付きの scope を渡し、旧 key を捨てる', () => {
			expect(layout).toMatch(/getChildTutorialProgressScope\(data\.child\.id,\s*uiMode\)/);
			expect(layout).toMatch(
				/discardSavedProgress\(getLegacyChildTutorialProgressScope\(uiMode\)\)/,
			);
		});

		it('家族共有の scope literal (child:<uiMode>) を直接渡さない', () => {
			// 検出対象は「子供 ID 抜きで uiMode だけを埋めた template literal」そのもの
			const familyScopedLiteral = ['`child:$', '{uiMode}`'].join('');
			expect(layout).not.toContain(familyScopedLiteral);
		});
	});
});
