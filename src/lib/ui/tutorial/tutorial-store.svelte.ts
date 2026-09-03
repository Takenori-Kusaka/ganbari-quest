import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { TutorialChapter, TutorialStep } from './tutorial-types';

// ── localStorage persistence keys ──
//
// #4651 (a): 進捗 key は **章セットごとに分離**する。旧実装は全ガイドが同じ 2 key を共有し、
// 同一端末で別のガイドを中断すると「前回の途中から続けますか？」が無関係なガイドで出た。
// `setChapters(chapters, scope)` の scope が key の namespace になる (既定 'default')。
const STORAGE_KEY_PREFIX = 'tutorial-progress';
let progressScope = 'default';

function chapterKey(): string {
	return `${STORAGE_KEY_PREFIX}:${progressScope}:chapter`;
}

function stepKey(): string {
	return `${STORAGE_KEY_PREFIX}:${progressScope}:step`;
}

/** 現在の進捗 namespace (test 用。key の形は `tutorial-progress:<scope>:chapter|step`)。 */
export function getProgressScope(): string {
	return progressScope;
}

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
}

const state = $state<TutorialState>({
	isActive: false,
	currentChapter: 1,
	currentStepIndex: 0,
	showResumePrompt: false,
	savedChapter: 1,
	savedStepIndex: 0,
});

/**
 * 表示中の章定義。
 *
 * #4654 (EPIC #4650 判断 2): 親の章立てチュートリアル (v1、22 step) を撤去したため、
 * 本 store の利用者は子供画面チュートリアル (`getChildTutorialChapters(uiMode)`) のみ。
 * 親管理画面の説明は ❓ ページガイド (`PageGuideOverlay`) が唯一の経路。
 * 既定は空配列で、`setChapters()` を呼ぶ画面 (子供 layout) でのみガイドが起動する。
 */
let activeChapters = $state<TutorialChapter[]>([]);

/**
 * 章定義を差し替える (子供 layout が uiMode に応じた章を渡す)。
 *
 * `scope` は進捗 (localStorage) の namespace。別のガイドの中断進捗を引き継がないよう、
 * ガイドの種類ごとに固有の値を渡す (例: `child:preschool`)。省略時は 'default'。
 */
export function setChapters(chapters: TutorialChapter[], scope = 'default') {
	activeChapters = chapters;
	progressScope = scope;
}

// ── localStorage helpers (SSR-safe) ──
function saveProgress(chapterId: number, stepIndex: number) {
	try {
		if (typeof window !== 'undefined') {
			localStorage.setItem(chapterKey(), String(chapterId));
			localStorage.setItem(stepKey(), String(stepIndex));
		}
	} catch {
		// localStorage unavailable — silently ignore
	}
}

function loadSavedProgress(): { chapter: number; stepIndex: number } | null {
	try {
		if (typeof window === 'undefined') return null;
		const ch = localStorage.getItem(chapterKey());
		const st = localStorage.getItem(stepKey());
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
	discardSavedProgress(progressScope);
}

/**
 * 指定 scope の保存済み進捗を捨てる (現在の scope 以外にも使える)。
 *
 * #4765 PO 回答 (2026-09-03): 子供ガイドの進捗 key を子供ごとに分けたため、それ以前の
 * 家族共有 key (`child:<uiMode>`) は誰の進捗か判別できず、読まずに捨てる。
 */
export function discardSavedProgress(scope: string) {
	try {
		if (typeof window !== 'undefined') {
			localStorage.removeItem(`${STORAGE_KEY_PREFIX}:${scope}:chapter`);
			localStorage.removeItem(`${STORAGE_KEY_PREFIX}:${scope}:step`);
		}
	} catch {
		// silently ignore
	}
}

/** #4765: 旧 key の後始末を一度だけ行ったことを示す端末ローカルの印。 */
const LEGACY_MIGRATION_FLAG_KEY = `${STORAGE_KEY_PREFIX}:legacy-migrated`;

/** `migrateLegacyProgress` の結果 (呼び出し側の分岐用ではなく、test / 診断用)。 */
export type LegacyProgressMigrationResult =
	| 'migrated' // 子供 1 人 = 持ち主が一意 → 引き継いだ
	| 'discarded' // 子供 2 人以上 = 持ち主不明 → 捨てた
	| 'no-legacy' // 旧 key が無い (新規ユーザー / 既に処理済)
	| 'already-done' // 一度処理済み (2 回目以降の mount では何もしない)
	| 'unavailable'; // localStorage が使えない

/**
 * #4765 以前の家族共有 key (`child:<uiMode>`) を後始末する。**端末ごとに 1 回だけ**走る。
 *
 * PO 回答 (2026-09-03) は「進捗 key を子供ごとに分ける」だが、旧 key を無条件に捨てると
 * **一度もこの不具合に当たっていない 1 人っ子の家庭まで進捗を失う**。旧 key の持ち主が
 * 一意に決まるとき (子供が 1 人) は引き継ぎ、決まらないとき (2 人以上) だけ捨てる。
 *
 * - 引き継ぎ先に既に進捗があれば**上書きしない** (新しい方が正しい)
 * - 処理後は印を立てて以降の mount では何もしない (per-mount で走らせない)
 *
 * @param legacyScope 旧 scope (`child:<uiMode>`)
 * @param targetScope 引き継ぎ先 scope (`child:<childId>:<uiMode>`)
 * @param childCount テナントの子供の人数 (1 = 持ち主が一意)
 */
export function migrateLegacyProgress(
	legacyScope: string,
	targetScope: string,
	childCount: number,
): LegacyProgressMigrationResult {
	try {
		if (typeof window === 'undefined') return 'unavailable';
		if (localStorage.getItem(LEGACY_MIGRATION_FLAG_KEY) === '1') return 'already-done';

		const legacyChapter = localStorage.getItem(`${STORAGE_KEY_PREFIX}:${legacyScope}:chapter`);
		const legacyStep = localStorage.getItem(`${STORAGE_KEY_PREFIX}:${legacyScope}:step`);
		localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, '1');

		if (legacyChapter == null && legacyStep == null) return 'no-legacy';

		if (childCount === 1) {
			const targetChapterKey = `${STORAGE_KEY_PREFIX}:${targetScope}:chapter`;
			const targetStepKey = `${STORAGE_KEY_PREFIX}:${targetScope}:step`;
			// 引き継ぎ先が空のときだけ書く (その子自身の新しい進捗を巻き戻さない)
			if (localStorage.getItem(targetChapterKey) == null) {
				if (legacyChapter != null) localStorage.setItem(targetChapterKey, legacyChapter);
				if (legacyStep != null) localStorage.setItem(targetStepKey, legacyStep);
			}
			discardSavedProgress(legacyScope);
			return 'migrated';
		}

		discardSavedProgress(legacyScope);
		return 'discarded';
	} catch {
		return 'unavailable';
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

export function getChapters() {
	return activeChapters;
}

/**
 * 共通のチュートリアル開始処理: state をリセットして最初のステップのページへ遷移する。
 * startTutorial / startFromBeginning で共通利用。
 */
async function activateChapter(chapterId: number) {
	state.showResumePrompt = false;
	state.isActive = true;
	state.currentChapter = chapterId;
	state.currentStepIndex = 0;
	saveProgress(chapterId, 0);

	const step = getCurrentStep();
	if (step?.page) {
		await goto(resolve(step.page));
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

	await activateChapter(chapter ?? 1);
}

/** Resume from saved progress */
export async function resumeTutorial() {
	state.showResumePrompt = false;
	state.isActive = true;
	state.currentChapter = state.savedChapter;
	state.currentStepIndex = state.savedStepIndex;

	const step = getCurrentStep();
	if (step?.page) {
		await goto(resolve(step.page));
	}
}

/** Start from the beginning, discarding saved progress */
export async function startFromBeginning(chapter?: number) {
	clearSavedProgress();
	await activateChapter(chapter ?? 1);
}

/** Dismiss the resume prompt without starting */
export function dismissResumePrompt() {
	state.showResumePrompt = false;
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
			await goto(resolve(step.page));
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
			await goto(resolve(step.page));
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
		await goto(resolve(step.page));
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
