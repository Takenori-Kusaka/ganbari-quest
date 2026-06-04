/**
 * Demo guide state — tracks progress through the guided demo flow.
 * Persists across navigations within the SPA session.
 */

// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom 参照
import { ADMIN_VIEW_TERMS } from '$lib/domain/terms';

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

// #2097 PR-B2 (#2187) + PR-B3 (#2188): /demo/(child)/* + /demo/(parent)/admin/* + /demo/signup
// 撤去に伴い、ガイド 全 step の matchPath / href を本番 routes (`/preschool/home` / `/admin/*` /
// `/auth/signup` 等) に切り替え。href の `?childId=902` は demo fixture child ID で、demo
// Lambda 本番環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo、ADR-0048) では tenant 透過に解決。
//
// LOCAL_AUTH E2E 環境では `?childId=902` が test tenant に無いため `/switch` に redirect され
// guide flow が機能しない。`tests/e2e/demo-guide-step-flow.spec.ts` は `selectChildByName` で
// pre-set した child を使う形に統一済。PR-B4 (#2189) で hooks.server.ts demo 検出を env-only
// 化した後に E2E 環境も demo Lambda env で再活性化する。
export const GUIDE_STEPS: GuideStep[] = [
	{
		id: 1,
		title: 'こどもの画面をみよう',
		description: '5さいの ひなちゃんで ためしてみましょう',
		matchPath: '/preschool/home',
		href: '/preschool/home?childId=902',
	},
	{
		id: 2,
		title: 'かつどうを きろくしよう',
		description: 'かつどうカードをタップして きろくしてみましょう（スキップもできます）',
		matchPath: '/preschool/home',
		href: '/preschool/home?childId=902',
	},
	{
		id: 3,
		title: 'ステータスを みよう',
		description: 'ひなちゃんの つよさを チェック！',
		matchPath: '/preschool/status',
		href: '/preschool/status?childId=902',
	},
	{
		id: 4,
		title: 'おやの画面をみよう',
		description: `おやの ${ADMIN_VIEW_TERMS.canonical}も たいけんできます`,
		matchPath: '/admin',
		href: '/admin',
	},
	{
		id: 5,
		title: 'プラン・お支払いを みよう',
		// #2836 (Epic #2525 Phase 7 PR-L4): license key 全廃に伴いキー適用デモ文言を撤去し、
		//   subscription (プランかんり) のデモ案内に置換。
		description: 'プランかんりの 画面を たいけんしてみましょう',
		matchPath: '/admin/subscription',
		href: '/admin/subscription',
	},
	{
		id: 6,
		title: 'いかがでしたか？',
		description: 'お子さまの ぼうけん、はじめませんか？',
		matchPath: '/auth/signup',
		href: '/auth/signup',
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
 * 同一 matchPath が連続するステップ（例: ステップ1→2は共に /preschool/home）では
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
