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
let explicitChapters = $state<TutorialChapter[]>([]);

/**
 * 章を「活動の有無」から組み立てる builder (子供 layout が渡す)。
 *
 * #4860 (adversarial must-A): 旧実装は layout の `onMount` が
 * `getChildTutorialChapters(uiMode, { hasActivities: true })` を **推測で** 置き、
 * ホーム画面が実件数で章を差し替え直す 2 段構えだった。しかし Svelte 5 の実行順は
 * **子の `$effect` → 親の `onMount`** なので、ホームの訂正が先に走り layout の推測が後から
 * 上書きする。結果、**活動 0 件の子が初めてアプリを開く場面** — つまり修正したかった当の状況 —
 * で「したのカードをタップ」が出続けた (実測: `{"cards":0,"tapCard":true}`)。
 * `(child)/checklist` はホームの `$effect` を一度も通らないため常に上書きされないままだった。
 *
 * 順序に依存しない形にするため、**layout は builder だけを渡し、件数はホームが state に書く**。
 * 章は両者の $derived なので、どちらが先に走っても最終値は同じになる。
 */
let chapterBuilder = $state<((hasActivities: boolean | undefined) => TutorialChapter[]) | null>(
	null,
);

/**
 * 活動があるか。`undefined` = **まだ分からない**。
 *
 * 件数を知っているのはホーム画面だけ (layout が件数のためだけに DB を引くのは ADR-0065 に反する)。
 * 分からない間は「カードをタップ」と言わせない (builder 側で `false` と同じ安全側に倒す) —
 * 存在しないカードを指すより、指さない方が害が小さい。
 */
let hasActivitiesKnown = $state<boolean | undefined>(undefined);

const activeChapters = $derived(
	chapterBuilder ? chapterBuilder(hasActivitiesKnown) : explicitChapters,
);

/**
 * 章定義を差し替える (子供 layout が uiMode に応じた章を渡す)。
 *
 * `scope` は進捗 (localStorage) の namespace。別のガイドの中断進捗を引き継がないよう、
 * ガイドの種類ごとに固有の値を渡す (例: `child:preschool`)。省略時は 'default'。
 */
export function setChapters(chapters: TutorialChapter[], scope = 'default') {
	explicitChapters = chapters;
	chapterBuilder = null;
	// 子供画面を離れるとき (`setChapters([])`) に件数の記憶も捨てる。
	// 持ち越すと、活動のある子から無い子へ切り替えた直後に前の子の件数で
	// 「カードをタップ」と言ってしまう。次に入った画面のホームが書き直すまでは「未知」が正しい。
	hasActivitiesKnown = undefined;
	progressScope = scope;
}

/**
 * 子供画面の章を builder 経由で差し替える (進捗 scope も同時に設定)。
 *
 * 件数は渡さない — 渡せる立場にないため。件数は `setChildActivityPresence` で別途書かれる。
 */
export function setChildChapterBuilder(
	builder: (hasActivities: boolean | undefined) => TutorialChapter[],
	scope: string,
) {
	chapterBuilder = builder;
	explicitChapters = [];
	progressScope = scope;
}

/**
 * 活動の有無を記録する。**件数を知っている画面 (ホーム) だけが呼ぶ。**
 *
 * builder が入っていれば章は自動的に derive し直される。builder より先に呼ばれても
 * (Svelte 5 は子の `$effect` が親の `onMount` より先に走る) 値は state に残るため失われない。
 *
 * `undefined` を渡すと「分からない」に戻す。ホームを離れるときに必ず戻すこと —
 * 持ち越すと、他の画面 (activity カードが存在しない `/checklist` 等) で
 * 「カードをタップすると」と案内してしまう (#4860 adversarial 実測)。
 */
export function setChildActivityPresence(hasActivities: boolean | undefined) {
	hasActivitiesKnown = hasActivities;
}

/** test / 検証用。`undefined` は「まだ分からない」。 */
export function getChildActivityPresence(): boolean | undefined {
	return hasActivitiesKnown;
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

/** 旧 scope とその引き継ぎ先の組。年齢モードの数だけ渡す (下記「モード横断」を参照)。 */
export interface LegacyProgressEntry {
	/** #4765 以前の家族共有 scope (`child:<uiMode>`) */
	legacyScope: string;
	/** 引き継ぎ先 scope (`child:<childId>:<uiMode>`) */
	targetScope: string;
}

/**
 * #4765 以前の家族共有 key (`child:<uiMode>`) を後始末する。**端末ごとに 1 回だけ**走る。
 *
 * PO 回答 (2026-09-03) は「進捗 key を子供ごとに分ける」だが、旧 key を無条件に捨てると
 * **一度もこの不具合に当たっていない 1 人っ子の家庭まで進捗を失う**。旧 key の持ち主が
 * 一意に決まるとき (子供が 1 人) は引き継ぎ、決まらないとき (2 人以上) だけ捨てる。
 *
 * **モード横断**: 旧 key は年齢モードごとに分かれている (`child:preschool` / `child:elementary` …)。
 * 子供の年齢モードは変わるため、「今のモードの旧 key」だけを見ると、モードが変わった子の進捗が
 * 引き継がれないまま端末に残り続ける。呼び出し側は**全モード分の entry** を渡し、本関数は
 * 1 回の処理で全部を畳む (子供 1 人 = すべてその子のもの / 2 人以上 = すべて持ち主不明)。
 *
 * - 引き継ぎ先に既に進捗があれば**上書きしない** (新しい方が正しい)
 * - 処理後は印 (`tutorial-progress:legacy-migrated`) を立て、以降の mount では何もしない
 *
 * @param entries 旧 scope → 引き継ぎ先 scope の組 (年齢モードの数だけ)
 * @param childCount テナントの子供の人数 (1 = 持ち主が一意)
 */
export function migrateLegacyProgress(
	entries: readonly LegacyProgressEntry[],
	childCount: number,
): LegacyProgressMigrationResult {
	try {
		if (typeof window === 'undefined') return 'unavailable';
		if (localStorage.getItem(LEGACY_MIGRATION_FLAG_KEY) === '1') return 'already-done';

		const found = entries
			.map((entry) => ({
				...entry,
				chapter: localStorage.getItem(`${STORAGE_KEY_PREFIX}:${entry.legacyScope}:chapter`),
				step: localStorage.getItem(`${STORAGE_KEY_PREFIX}:${entry.legacyScope}:step`),
			}))
			.filter((entry) => entry.chapter != null || entry.step != null);

		localStorage.setItem(LEGACY_MIGRATION_FLAG_KEY, '1');
		if (found.length === 0) return 'no-legacy';

		for (const entry of found) {
			if (childCount === 1) {
				const targetChapterKey = `${STORAGE_KEY_PREFIX}:${entry.targetScope}:chapter`;
				const targetStepKey = `${STORAGE_KEY_PREFIX}:${entry.targetScope}:step`;
				// 引き継ぎ先が空のときだけ書く (その子自身の新しい進捗を巻き戻さない)
				if (localStorage.getItem(targetChapterKey) == null) {
					if (entry.chapter != null) localStorage.setItem(targetChapterKey, entry.chapter);
					if (entry.step != null) localStorage.setItem(targetStepKey, entry.step);
				}
			}
			discardSavedProgress(entry.legacyScope);
		}

		return childCount === 1 ? 'migrated' : 'discarded';
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

/**
 * `getCurrentStep()` が直前に返した step (#4923 参照安定化キャッシュ)。
 * `$state` ではない素の module 変数でよい — 副作用ではなく「同じ論理値なら同じ参照を
 * 返す」memoization であり、`getCurrentStep()` 自体は `activeChapters` /
 * `state.currentChapter` / `state.currentStepIndex` という追跡対象だけから決定的に導出する。
 */
let lastResolvedStep: TutorialStep | null = null;

/** id / selector / title 等、表示・対象解決に関わる項目が一致すれば「同じ step」とみなす。 */
function stepsAreEquivalent(a: TutorialStep | null, b: TutorialStep | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.id === b.id &&
		a.chapterId === b.chapterId &&
		a.selector === b.selector &&
		a.title === b.title &&
		a.description === b.description &&
		a.position === b.position &&
		a.page === b.page &&
		a.requiredTier === b.requiredTier
	);
}

/**
 * 現在の step を返す。
 *
 * #4923 (本番の子供 ❓ ガイドが 5 step とも中央 fallback になる): `activeChapters` は
 * `chapterBuilder(hasActivitiesKnown)` の**新しい配列**を毎回返すため、内容が論理的に
 * 同一でも (例: `hasActivitiesKnown` が `true` → `undefined` → `true` と書き直されるだけ)
 * `getCurrentStep()` は毎回**新しい object 参照**を返していた。呼び出し側
 * (`tutorial-step-controller.svelte.ts` の `$derived(getCurrentStep())`) を購読する
 * `$effect` は参照が変われば再実行されるため、対象要素の解決 (scrollIntoView → 実測 →
 * resolved 反映という複数ステップの非同期処理) が完走する前に abort → やり直しを
 * 繰り返し、対象が実在し可視であっても `data-tutorial-target` が `resolved` に到達しない
 * フリッカーになっていた (実機: 自動リロード間隔を短縮したエミュレーションで再現・修正確認済)。
 *
 * 直前に返した step と論理的に同一 (id / selector / title 等が一致) であれば、**同じ参照**
 * を返して `$derived` の dirty 判定を素通りさせる (Object.is 比較で「変化なし」とみなされ、
 * 依存する effect は再実行されない)。id が変わる本物の step 遷移では通常どおり新しい
 * 参照を返し、対象解決を正しくやり直す。
 */
export function getCurrentStep(): TutorialStep | null {
	if (!state.isActive) {
		lastResolvedStep = null;
		return null;
	}
	const chapter = activeChapters.find((ch) => ch.id === state.currentChapter);
	const raw = chapter ? (chapter.steps[state.currentStepIndex] ?? null) : null;
	if (stepsAreEquivalent(raw, lastResolvedStep)) {
		return lastResolvedStep;
	}
	lastResolvedStep = raw;
	return raw;
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
