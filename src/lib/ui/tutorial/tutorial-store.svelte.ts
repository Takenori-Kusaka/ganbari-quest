import { goto } from '$app/navigation';
import { TUTORIAL_CHAPTERS } from './tutorial-chapters';
import type { TutorialChapter, TutorialStep } from './tutorial-types';

// ── localStorage persistence keys ──
const STORAGE_KEY_CHAPTER = 'tutorial-progress-chapter';
const STORAGE_KEY_STEP = 'tutorial-progress-step';

interface TutorialState {
	isActive: boolean;
	currentChapter: number;
	currentStepIndex: number;
	/** Whether a resume prompt is being shown */
	showResumePrompt: boolean;
	/** Saved chapter id from previous session */
	savedChapter: number;
	/** Saved step index from previous session */
	savedStepIndex: number;
	/** #955: クイックモード — 初回はチャプター1のみ表示し、終了後に継続を提案 */
	quickMode: boolean;
	/** #955: クイックモード完了（チャプター1終了後の選択画面） */
	showQuickComplete: boolean;
	/**
	 * #961 QA: クイックモード対象（親チャプター）かどうか。
	 * 子チャプターに切替中は false になり、quickMode は有効化されない。
	 */
	isParentChapters: boolean;
}

const state = $state<TutorialState>({
	isActive: false,
	currentChapter: 1,
	currentStepIndex: 0,
	showResumePrompt: false,
	savedChapter: 1,
	savedStepIndex: 0,
	quickMode: false,
	showQuickComplete: false,
	isParentChapters: true,
});

// Configurable chapter source (default: parent admin chapters)
let activeChapters = $state<TutorialChapter[]>(TUTORIAL_CHAPTERS);

/** Switch the chapter set (e.g. for child tutorial) */
export function setChapters(chapters: TutorialChapter[]) {
	activeChapters = chapters;
	// #961 QA: 親チャプター（TUTORIAL_CHAPTERS）のみクイックモード対象
	state.isParentChapters = chapters === TUTORIAL_CHAPTERS;
}

/** Reset to default parent admin chapters */
export function resetChapters() {
	activeChapters = TUTORIAL_CHAPTERS;
	state.isParentChapters = true;
}

// ── localStorage helpers (SSR-safe) ──
function saveProgress(chapterId: number, stepIndex: number) {
	try {
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY_CHAPTER, String(chapterId));
			localStorage.setItem(STORAGE_KEY_STEP, String(stepIndex));
		}
	} catch {
		// localStorage unavailable — silently ignore
	}
}

function loadSavedProgress(): { chapter: number; stepIndex: number } | null {
	try {
		if (typeof window === 'undefined') return null;
		const ch = localStorage.getItem(STORAGE_KEY_CHAPTER);
		const st = localStorage.getItem(STORAGE_KEY_STEP);
		if (ch == null || st == null) return null;
		const chapter = Number.parseInt(ch, 10);
		const stepIndex = Number.parseInt(st, 10);
		if (Number.isNaN(chapter) || Number.isNaN(stepIndex)) return null;
		// Validate that the saved chapter and step still exist
		const chapterData = activeChapters.find((c) => c.id === chapter);
		if (!chapterData) return null;
		if (stepIndex < 0 || stepIndex >= chapterData.steps.length) return null;
		return { chapter, stepIndex };
	} catch {
		return null;
	}
}

function clearSavedProgress() {
	try {
		if (typeof window !== 'undefined') {
			localStorage.removeItem(STORAGE_KEY_CHAPTER);
			localStorage.removeItem(STORAGE_KEY_STEP);
		}
	} catch {
		// silently ignore
	}
}

function flatSteps(): TutorialStep[] {
	return activeChapters.flatMap((ch) => ch.steps);
}

function flatIndex(): number {
	const allSteps = flatSteps();
	const current = getCurrentStep();
	if (!current) return 0;
	return allSteps.findIndex((s) => s.id === current.id);
}

export function getCurrentStep(): TutorialStep | null {
	if (!state.isActive) return null;
	const chapter = activeChapters.find((ch) => ch.id === state.currentChapter);
	if (!chapter) return null;
	return chapter.steps[state.currentStepIndex] ?? null;
}

export function getProgress(): { current: number; total: number } {
	return {
		current: flatIndex() + 1,
		total: flatSteps().length,
	};
}

export function getCurrentChapterInfo() {
	return activeChapters.find((ch) => ch.id === state.currentChapter) ?? null;
}

export function isTutorialActive(): boolean {
	return state.isActive;
}

export function isResumePromptShown(): boolean {
	return state.showResumePrompt;
}

export function getSavedProgress(): { chapter: number; stepIndex: number } {
	return { chapter: state.savedChapter, stepIndex: state.savedStepIndex };
}

export function getChapters() {
	return activeChapters;
}

/**
 * 共通のチュートリアル開始処理: state をリセットして最初のステップのページへ遷移する。
 * startTutorial / startFromBeginning / startTutorialForPage で共通利用。
 */
async function activateChapter(chapterId: number, quickMode: boolean) {
	state.showResumePrompt = false;
	state.showQuickComplete = false;
	state.quickMode = quickMode;
	state.isActive = true;
	state.currentChapter = chapterId;
	state.currentStepIndex = 0;
	saveProgress(chapterId, 0);

	const step = getCurrentStep();
	if (step?.page) {
		await goto(step.page);
	}
}

export async function startTutorial(chapter?: number) {
	// If no explicit chapter is given, check for saved progress
	if (chapter == null) {
		const saved = loadSavedProgress();
		if (saved && (saved.chapter > 1 || saved.stepIndex > 0)) {
			// Show resume prompt
			state.savedChapter = saved.chapter;
			state.savedStepIndex = saved.stepIndex;
			state.showResumePrompt = true;
			return;
		}
	}

	const chapterId = chapter ?? 1;
	// #955: 明示的なチャプター指定なし（初回開始）の場合はクイックモード
	// #961 QA: ただし親チャプター中のみ有効。子チャプター等では全ステップ通常表示
	const isQuickStart = chapter == null && state.isParentChapters;
	await activateChapter(chapterId, isQuickStart);
}

/** #955: クイック完了画面が表示中か */
export function isQuickCompleteShown(): boolean {
	return state.showQuickComplete;
}

/** #955: クイックモード中か（チャプター1のみ表示） */
export function isQuickModeActive(): boolean {
	return state.quickMode;
}

/** #955: クイック完了から全チュートリアルを継続（チャプター2から） */
export async function continueFullTutorial() {
	state.showQuickComplete = false;
	state.quickMode = false;
	const nextChapter = activeChapters.find((ch) => ch.id === 2);
	if (nextChapter) {
		state.currentChapter = nextChapter.id;
		state.currentStepIndex = 0;
		saveProgress(nextChapter.id, 0);
		const step = getCurrentStep();
		if (step?.page) {
			await goto(step.page);
		}
	} else {
		await completeTutorial();
	}
}

/** #955: クイック完了でチュートリアルを終了 */
export async function finishQuickTutorial() {
	state.showQuickComplete = false;
	state.quickMode = false;
	await completeTutorial();
}

/** Resume from saved progress */
export async function resumeTutorial() {
	state.showResumePrompt = false;
	state.isActive = true;
	state.currentChapter = state.savedChapter;
	state.currentStepIndex = state.savedStepIndex;

	const step = getCurrentStep();
	if (step?.page) {
		await goto(step.page);
	}
}

/** Start from the beginning, discarding saved progress */
export async function startFromBeginning(chapter?: number) {
	clearSavedProgress();
	// #955: 明示的なチャプター指定なし（最初から）の場合はクイックモード
	// #961 QA: ただし親チャプター中のみ有効
	await activateChapter(chapter ?? 1, chapter == null && state.isParentChapters);
}

/** Dismiss the resume prompt without starting */
export function dismissResumePrompt() {
	state.showResumePrompt = false;
}

/**
 * Start tutorial from the chapter most relevant to the current URL path.
 * Falls back to chapter 1 if no matching chapter is found.
 */
export async function startTutorialForPage(pathname: string) {
	const chapterId = resolveChapterForPath(pathname);

	// If a matching chapter is found (not chapter 1), skip directly there
	if (chapterId > 1) {
		await activateChapter(chapterId, false);
		return;
	}

	// Otherwise, fall back to normal start (which may show resume prompt)
	await startTutorial();
}

/**
 * Map a URL pathname to the best-matching tutorial chapter ID.
 * Returns the chapter id, or 1 (intro) as fallback.
 */
function resolveChapterForPath(pathname: string): number {
	// Build a mapping from page paths to chapter IDs
	// Check the most specific paths first
	for (const chapter of activeChapters) {
		for (const step of chapter.steps) {
			if (step.page && pathname.startsWith(step.page) && step.page !== '/admin') {
				return chapter.id;
			}
		}
	}
	// Default to intro
	return 1;
}

export async function nextStep() {
	const chapter = activeChapters.find((ch) => ch.id === state.currentChapter);
	if (!chapter) return;

	if (state.currentStepIndex < chapter.steps.length - 1) {
		state.currentStepIndex++;
	} else {
		// Move to next chapter
		const nextChapter = activeChapters.find((ch) => ch.id === state.currentChapter + 1);
		if (nextChapter) {
			// #955: クイックモードではチャプター1終了後に選択画面を表示
			if (state.quickMode && state.currentChapter === 1) {
				state.showQuickComplete = true;
				return;
			}
			state.currentChapter = nextChapter.id;
			state.currentStepIndex = 0;
		} else {
			// Tutorial complete
			await completeTutorial();
			return;
		}
	}

	saveProgress(state.currentChapter, state.currentStepIndex);

	const step = getCurrentStep();
	if (step?.page && typeof window !== 'undefined') {
		const currentPath = window.location.pathname;
		if (currentPath !== step.page) {
			await goto(step.page);
		}
	}
}

export async function prevStep() {
	if (state.currentStepIndex > 0) {
		state.currentStepIndex--;
	} else {
		// Move to previous chapter's last step
		const prevChapter = activeChapters.find((ch) => ch.id === state.currentChapter - 1);
		if (prevChapter) {
			state.currentChapter = prevChapter.id;
			state.currentStepIndex = prevChapter.steps.length - 1;
		}
	}

	saveProgress(state.currentChapter, state.currentStepIndex);

	const step = getCurrentStep();
	if (step?.page && typeof window !== 'undefined') {
		const currentPath = window.location.pathname;
		if (currentPath !== step.page) {
			await goto(step.page);
		}
	}
}

export async function skipToChapter(chapterId: number) {
	const chapter = activeChapters.find((ch) => ch.id === chapterId);
	if (!chapter) return;

	state.currentChapter = chapterId;
	state.currentStepIndex = 0;
	saveProgress(chapterId, 0);

	const step = getCurrentStep();
	if (step?.page) {
		await goto(step.page);
	}
}

export function endTutorial() {
	// Save current progress before ending so it can be resumed later
	if (state.isActive) {
		saveProgress(state.currentChapter, state.currentStepIndex);
	}
	state.isActive = false;
	state.currentChapter = 1;
	state.currentStepIndex = 0;
	state.quickMode = false;
	state.showQuickComplete = false;
}

async function completeTutorial() {
	state.isActive = false;
	clearSavedProgress();

	// Persist completion to server
	try {
		await fetch('/api/v1/settings/tutorial', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'complete' }),
		});
	} catch {
		// silently ignore
	}
}

export async function markTutorialStarted() {
	try {
		await fetch('/api/v1/settings/tutorial', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'start' }),
		});
	} catch {
		// silently ignore
	}
}

export async function dismissTutorialBanner() {
	try {
		await fetch('/api/v1/settings/tutorial', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'dismiss' }),
		});
	} catch {
		// silently ignore
	}
}
