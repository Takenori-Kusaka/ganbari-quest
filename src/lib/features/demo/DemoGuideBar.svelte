<script lang="ts">
import { untrack } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { trackDemoEvent } from './demo-analytics.js';
import {
	advanceStep,
	checkAutoAdvance,
	dismissGuide,
	GUIDE_STEPS,
	getGuideState,
	goBack,
} from './demo-guide-state.svelte.js';

const guide = getGuideState();

// Auto-advance when the user navigates to the expected page.
//
// #702: untrack で囲うことで、checkAutoAdvance 内部で読まれる currentStep の
// reactive read をこの effect の依存にしない。
// untrack なしだと「もどる」操作で goBack() → currentStep--- → effect 再実行
// → 古い pathname (ナビゲーション前の URL) に対して checkAutoAdvance が走り、
// 「次のステップ (=今いるステップ)」のパスにマッチして currentStep が
// 即座に元に戻る、という競合が発生する。
// この effect は "URL 変化を観測してガイド進行を同期する" 役割なので、
// 依存は $page.url.pathname だけで十分。
$effect(() => {
	const pathname = $page.url.pathname;
	untrack(() => {
		checkAutoAdvance(pathname);
	});
});

// #702: つぎへ / もどる は <a href> ではなく <button> + 明示 goto() で実装する。
// <a href={nextStep.href}> を使うと、onclick で currentStep を進めた瞬間に Svelte 5 の
// reactive バインディングが nextStep を *次の次* のステップに再評価し、ブラウザはその
// 新しい href へナビゲートする → $page 変化を契機に checkAutoAdvance がさらにもう
// 1 段進めてしまい、1 クリックで 2 ステップ飛ぶ（1→3→5 の症状）。
// state 変更前に target URL をスナップショットすることで race を断つ。
function handleAdvance() {
	const fromStep = guide.currentStep;
	const targetHref = GUIDE_STEPS[fromStep + 1]?.href;
	advanceStep();
	trackDemoEvent('demo_guide_step', {
		fromStep: fromStep + 1,
		toStep: guide.currentStep + 1,
	});
	if (targetHref) {
		goto(targetHref);
	}
}

function handleBack() {
	const fromStep = guide.currentStep;
	const targetHref = GUIDE_STEPS[fromStep - 1]?.href;
	goBack();
	trackDemoEvent('demo_guide_step', {
		fromStep: fromStep + 1,
		toStep: guide.currentStep + 1,
		direction: 'back',
	});
	if (targetHref) {
		goto(targetHref);
	}
}

function handleDismiss() {
	trackDemoEvent('demo_guide_dismiss', { step: guide.currentStep });
	dismissGuide();
}
</script>

{#if guide.active}
	<div class="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom" data-testid="demo-guide-bar">
		<div class="mx-3 mb-3 bg-[var(--color-surface-card)] rounded-2xl shadow-xl border border-[var(--color-feedback-info-border)] overflow-hidden">
			<!-- Progress bar -->
			<div class="h-1 bg-[var(--color-surface-muted-strong)]">
				<div
					class="h-full bg-gradient-to-r from-[var(--color-brand-400)] to-[var(--color-brand-500)] transition-all duration-500"
					style:width="{((guide.currentStep + 1) / guide.totalSteps) * 100}%"
				></div>
			</div>

			<div class="p-3 flex items-center gap-3">
				<!-- Back button (#702: button + 明示 goto で href race を回避) -->
				{#if !guide.isFirstStep}
					<button
						type="button"
						class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm hover:bg-gray-200 transition-colors"
						onclick={handleBack}
						aria-label="もどる"
						data-testid="demo-guide-back"
					>
						&#8249;
					</button>
				{/if}

				<!-- Step indicator -->
				<div class="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--color-brand-500)] text-white flex items-center justify-center text-sm font-bold">
					{guide.currentStep + 1}
				</div>

				<!-- Content -->
				<div class="flex-1 min-w-0">
					<p class="text-sm font-bold text-[var(--color-text)] leading-tight">{guide.step?.title}</p>
					<p class="text-xs text-[var(--color-text-muted)] leading-snug line-clamp-2">{guide.step?.description}</p>
				</div>

				<!-- Action -->
				<div class="flex-shrink-0 flex items-center gap-1">
					{#if guide.isLastStep}
						<!-- #705: ガイド完了後の分岐 — プラン比較（HP pricing）と はじめる（signup）の両方を提示 -->
						<a
							href="https://www.ganbari-quest.com/pricing.html"
							class="px-2 py-1.5 text-[var(--color-text-link)] text-xs font-medium hover:underline whitespace-nowrap"
							data-testid="demo-guide-see-pricing"
							onclick={() => trackDemoEvent('demo_guide_see_pricing', { step: guide.currentStep + 1 })}
						>
							プランを見る
						</a>
						<a
							href="/demo/signup"
							class="px-3 py-1.5 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white text-xs font-bold rounded-lg"
							data-testid="demo-guide-start"
						>
							はじめる
						</a>
					{:else if guide.step?.requiresAction}
						<!-- Action-required step: show hint instead of navigation button -->
						<span class="px-2 py-1 text-xs text-blue-500 font-medium">
							<span aria-hidden="true">👆</span> やってみよう
						</span>
					{:else if guide.currentStep + 1 < GUIDE_STEPS.length}
						<!-- #702: <a href> ではなく button + handleAdvance(goto 内蔵) で進行する -->
						<button
							type="button"
							class="px-3 py-1.5 bg-[var(--color-brand-500)] text-white text-xs font-bold rounded-lg"
							onclick={handleAdvance}
							data-testid="demo-guide-next"
						>
							つぎへ
						</button>
					{/if}
					<button
						type="button"
						class="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-lg leading-none"						onclick={handleDismiss}						aria-label="ガイドを閉じる"
					>
						&times;
					</button>
				</div>
			</div>

			<!-- Step dots -->
			<div class="flex justify-center gap-1.5 pb-2">
				{#each GUIDE_STEPS as _, i}
					<div
						class="w-1.5 h-1.5 rounded-full transition-colors {i <= guide.currentStep ? 'bg-[var(--color-brand-500)]' : 'bg-[var(--color-neutral-200)]'}"
					></div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	.safe-area-bottom {
		padding-bottom: env(safe-area-inset-bottom, 0);
	}
</style>
