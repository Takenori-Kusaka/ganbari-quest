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
}

export const GUIDE_STEPS: GuideStep[] = [
	{
		id: 1,
		title: 'こどもの画面をみよう',
		description: '5さいの たろうくんで ためしてみましょう',
		matchPath: '/demo/kinder/home',
		href: '/demo/kinder/home?childId=902',
	},
	{
		id: 2,
		title: 'かつどうを きろくしよう',
		description: 'かつどうカードをタップして きろくしてみましょう',
		matchPath: '/demo/kinder/home',
		href: '/demo/kinder/home?childId=902',
	},
	{
		id: 3,
		title: 'ステータスを みよう',
		description: 'たろうくんの つよさを チェック！',
		matchPath: '/demo/kinder/status',
		href: '/demo/kinder/status?childId=902',
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
	guideDismissed = true;
}

export function advanceStep() {
	if (currentStep < GUIDE_STEPS.length - 1) {
		currentStep++;
	}
}

export function getGuideState() {
	return {
		get active() {
			return guideActive && !guideDismissed;
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
		get isLastStep() {
			return currentStep >= GUIDE_STEPS.length - 1;
		},
	};
}

/**
 * Called on page navigation to auto-advance the guide
 * when the user has navigated to the expected page for the next step.
 *
 * 同一 matchPath が連続するステップ（例: ステップ1→2は共に /demo/kinder/home）では
 * URL遷移だけでは区別できないため auto-advance をスキップする。
 * そのようなステップは advanceStep() で明示的に進める。
 */
export function checkAutoAdvance(pathname: string) {
	if (!guideActive || guideDismissed) return;

	const nextStepIndex = currentStep + 1;
	if (nextStepIndex >= GUIDE_STEPS.length) return;

	const nextStep = GUIDE_STEPS[nextStepIndex];
	if (!nextStep || !pathname.startsWith(nextStep.matchPath)) return;

	// 現在のステップと次のステップが同一パスならスキップ（手動遷移を待つ）
	const currentMatchPath = GUIDE_STEPS[currentStep]?.matchPath;
	if (currentMatchPath === nextStep.matchPath) return;

	currentStep = nextStepIndex;
}
