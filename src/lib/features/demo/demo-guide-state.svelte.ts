/**
 * Demo guide state — tracks progress through the guided demo flow.
 * Persists across navigations within the SPA session.
 */

export interface GuideStep {
	id: number;
	title: string;
	description: string;
	/** URL path prefix that this step corresponds to */
	matchPath: string;
	/** URL to navigate to for this step */
	href: string;
	/**
	 * If true, this step requires an explicit action (e.g. recording an activity)
	 * and should NOT show the "つぎへ" navigation button.
	 * Advance via advanceStep() from the action handler.
	 */
	requiresAction?: boolean;
}

export const GUIDE_STEPS: GuideStep[] = [
	{
		id: 1,
		title: 'こどもの画面をみよう',
		description: '5さいの たろうくんで ためしてみましょう',
		matchPath: '/demo/preschool/home',
		href: '/demo/preschool/home?childId=902',
	},
	{
		id: 2,
		title: 'かつどうを きろくしよう',
		description: 'かつどうカードをタップして きろくしてみましょう（スキップもできます）',
		matchPath: '/demo/preschool/home',
		href: '/demo/preschool/home?childId=902',
	},
	{
		id: 3,
		title: 'ステータスを みよう',
		description: 'たろうくんの つよさを チェック！',
		matchPath: '/demo/preschool/status',
		href: '/demo/preschool/status?childId=902',
	},
	{
		id: 4,
		title: 'おやの画面をみよう',
		description: 'おやの 管理画面も たいけんできます',
		matchPath: '/demo/admin',
		href: '/demo/admin',
	},
	{
		id: 5,
		title: 'いかがでしたか？',
		description: 'お子さまの ぼうけん、はじめませんか？',
		matchPath: '/demo/signup',
		href: '/demo/signup',
	},
];

let guideActive = $state(false);
let currentStep = $state(0);
let guideDismissed = $state(false);

export function startGuide() {
	guideActive = true;
	currentStep = 0;
	guideDismissed = false;
}

export function dismissGuide() {
	guideActive = false;
	guideDismissed = true;
}

/**
 * Restart a previously dismissed guide from the beginning.
 */
export function restartGuide() {
	guideActive = true;
	currentStep = 0;
	guideDismissed = false;
}

/**
 * Reset guide state when navigating back to /demo top.
 * Deactivates the guide without marking it as dismissed,
 * so the "ガイドを再開" button can offer to restart.
 */
export function resetGuide() {
	guideActive = false;
	currentStep = 0;
}

export function advanceStep() {
	if (currentStep < GUIDE_STEPS.length - 1) {
		currentStep++;
	}
}

/**
 * Go back one step.
 */
export function goBack() {
	if (currentStep > 0) {
		currentStep--;
	}
}

export function getGuideState() {
	return {
		get active() {
			return guideActive && !guideDismissed;
		},
		get dismissed() {
			return guideDismissed;
		},
		get wasStarted() {
			return guideActive || guideDismissed;
		},
		get currentStep() {
			return currentStep;
		},
		get step() {
			return GUIDE_STEPS[currentStep];
		},
		get totalSteps() {
			return GUIDE_STEPS.length;
		},
		get isFirstStep() {
			return currentStep === 0;
		},
		get isLastStep() {
			return currentStep >= GUIDE_STEPS.length - 1;
		},
	};
}

/**
 * Called on page navigation to auto-advance the guide
 * when the user has navigated to the expected page for the next step.
 *
 * 同一 matchPath が連続するステップ（例: ステップ1→2は共に /demo/preschool/home）では
 * URL遷移だけでは区別できないため auto-advance をスキップする。
 * そのようなステップは advanceStep() で明示的に進める。
 *
 * requiresAction ステップも auto-advance をスキップする。
 */
export function checkAutoAdvance(pathname: string) {
	if (!guideActive || guideDismissed) return;

	const nextStepIndex = currentStep + 1;
	if (nextStepIndex >= GUIDE_STEPS.length) return;

	const nextStep = GUIDE_STEPS[nextStepIndex];
	if (!nextStep || !pathname.startsWith(nextStep.matchPath)) return;

	// 現在のステップが requiresAction なら、パス遷移だけではスキップさせない
	const currentStepDef = GUIDE_STEPS[currentStep];
	if (currentStepDef?.requiresAction) return;

	// 次のステップが requiresAction の場合も明示的な advanceStep() を待つ
	if (nextStep.requiresAction) return;

	// 現在のステップと次のステップが同一パスならスキップ（手動遷移を待つ）
	const currentMatchPath = GUIDE_STEPS[currentStep]?.matchPath;
	if (currentMatchPath === nextStep.matchPath) return;

	currentStep = nextStepIndex;
}
