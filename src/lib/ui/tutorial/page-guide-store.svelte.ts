/**
 * ページ別オンデマンドガイド — 状態管理ストア
 *
 * ページ完結型のガイドシステム。
 * 各管理画面のヘルプボタンから起動し、そのページのガイドだけを表示する。
 * 完了状態は localStorage にページ単位で保存する。
 */

import type { GuideStep, PageGuide } from './page-guide-types';

const STORAGE_KEY = 'ganbari-page-guide-completed';

interface PageGuideState {
	isActive: boolean;
	currentPageId: string | null;
	currentStepIndex: number;
	guide: PageGuide | null;
}

const state = $state<PageGuideState>({
	isActive: false,
	currentPageId: null,
	currentStepIndex: 0,
	guide: null,
});

// ──────────────────────────────────────
// 完了状態の永続化（localStorage）
// ──────────────────────────────────────

function getCompletedPages(): Set<string> {
	if (typeof localStorage === 'undefined') return new Set();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Set();
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return new Set();
	}
}

function markPageCompleted(pageId: string) {
	if (typeof localStorage === 'undefined') return;
	const completed = getCompletedPages();
	completed.add(pageId);
	localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
}

/** 特定ページのガイドが完了済みか */
export function isPageGuideCompleted(pageId: string): boolean {
	return getCompletedPages().has(pageId);
}

/** 全ページの完了状態をリセット */
export function resetAllPageGuides() {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(STORAGE_KEY);
}

// ──────────────────────────────────────
// ガイドの起動・ナビゲーション
// ──────────────────────────────────────

/** ページガイドを起動する */
export function startPageGuide(guide: PageGuide) {
	state.isActive = true;
	state.currentPageId = guide.pageId;
	state.currentStepIndex = 0;
	state.guide = guide;
}

/** ガイドを終了する（途中終了含む） */
export function endPageGuide() {
	state.isActive = false;
	state.currentPageId = null;
	state.currentStepIndex = 0;
	state.guide = null;
}

/** ガイドを完了する（最終ステップ到達時） */
export function completePageGuide() {
	if (state.currentPageId) {
		markPageCompleted(state.currentPageId);
	}
	endPageGuide();
}

/** 次のステップへ */
export function nextGuideStep() {
	if (!state.guide) return;
	if (state.currentStepIndex < state.guide.steps.length - 1) {
		state.currentStepIndex++;
	} else {
		completePageGuide();
	}
}

/** 前のステップへ */
export function prevGuideStep() {
	if (state.currentStepIndex > 0) {
		state.currentStepIndex--;
	}
}

// ──────────────────────────────────────
// 読み取り用関数
// ──────────────────────────────────────

/** ガイドがアクティブか */
export function isPageGuideActive(): boolean {
	return state.isActive;
}

/** 現在のステップを取得 */
export function getCurrentGuideStep(): GuideStep | null {
	if (!state.isActive || !state.guide) return null;
	return state.guide.steps[state.currentStepIndex] ?? null;
}

/** 現在のガイド情報を取得 */
export function getCurrentGuideInfo(): PageGuide | null {
	return state.guide;
}

/** 進捗を取得 */
export function getGuideProgress(): { current: number; total: number } {
	if (!state.guide) return { current: 0, total: 0 };
	return {
		current: state.currentStepIndex + 1,
		total: state.guide.steps.length,
	};
}

/** 最初のステップか */
export function isFirstGuideStep(): boolean {
	return state.currentStepIndex === 0;
}

/** 最後のステップか */
export function isLastGuideStep(): boolean {
	if (!state.guide) return true;
	return state.currentStepIndex === state.guide.steps.length - 1;
}
