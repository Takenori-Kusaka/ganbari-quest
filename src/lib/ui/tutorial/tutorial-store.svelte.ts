import { goto } from '$app/navigation';
import { TUTORIAL_CHAPTERS } from './tutorial-chapters';
import type { TutorialChapter, TutorialStep } from './tutorial-types';

interface TutorialState {
	isActive: boolean;
	currentChapter: number;
	currentStepIndex: number;
}

const state = $state<TutorialState>({
	isActive: false,
	currentChapter: 1,
	currentStepIndex: 0,
});

// Configurable chapter source (default: parent admin chapters)
let activeChapters = $state<TutorialChapter[]>(TUTORIAL_CHAPTERS);

/** Switch the chapter set (e.g. for child tutorial) */
export function setChapters(chapters: TutorialChapter[]) {
	activeChapters = chapters;
}

/** Reset to default parent admin chapters */
export function resetChapters() {
	activeChapters = TUTORIAL_CHAPTERS;
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

export function getChapters() {
	return activeChapters;
}

export async function startTutorial(chapter?: number) {
	const chapterId = chapter ?? 1;
	state.isActive = true;
	state.currentChapter = chapterId;
	state.currentStepIndex = 0;

	const step = getCurrentStep();
	if (step?.page) {
		await goto(step.page);
	}
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

	const step = getCurrentStep();
	if (step?.page) {
		await goto(step.page);
	}
}

export function endTutorial() {
	state.isActive = false;
	state.currentChapter = 1;
	state.currentStepIndex = 0;
}

async function completeTutorial() {
	state.isActive = false;

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
