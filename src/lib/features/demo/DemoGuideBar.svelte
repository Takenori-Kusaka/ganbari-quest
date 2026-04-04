<script lang="ts">
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

// Auto-advance when the user navigates to the expected page
$effect(() => {
	checkAutoAdvance($page.url.pathname);
});

function handleAdvance() {
	const fromStep = guide.currentStep;
	advanceStep();
	trackDemoEvent('demo_guide_step', {
		fromStep: fromStep + 1,
		toStep: guide.currentStep + 1,
	});
}

function handleBack() {
	const fromStep = guide.currentStep;
	goBack();
	trackDemoEvent('demo_guide_step', {
		fromStep: fromStep + 1,
		toStep: guide.currentStep + 1,
		direction: 'back',
	});
}

function handleDismiss() {
	trackDemoEvent('demo_guide_dismiss', { step: guide.currentStep });
	dismissGuide();
}
</script>

{#if guide.active}
	<div class="fixed bottom-0 left-0 right-0 z-40 safe-area-bottom">
		<div class="mx-3 mb-3 bg-white rounded-2xl shadow-xl border border-blue-200 overflow-hidden">
			<!-- Progress bar -->
			<div class="h-1 bg-gray-100">
				<div
					class="h-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-500"
					style:width="{((guide.currentStep + 1) / guide.totalSteps) * 100}%"
				></div>
			</div>

			<div class="p-3 flex items-center gap-3">
				<!-- Back button -->
				{#if !guide.isFirstStep}
					{@const prevStep = GUIDE_STEPS[guide.currentStep - 1]}
					{#if prevStep}
						<a
							href={prevStep.href}
							class="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm hover:bg-gray-200 transition-colors"
							onclick={handleBack}
							aria-label="もどる"
						>
							&#8249;
						</a>
					{/if}
				{/if}

				<!-- Step indicator -->
				<div class="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
					{guide.currentStep + 1}
				</div>

				<!-- Content -->
				<div class="flex-1 min-w-0">
					<p class="text-sm font-bold text-gray-700 truncate">{guide.step?.title}</p>
					<p class="text-xs text-gray-500 truncate">{guide.step?.description}</p>
				</div>

				<!-- Action -->
				<div class="flex-shrink-0 flex items-center gap-1">
					{#if guide.isLastStep}
						<a
							href="/demo/signup"
							class="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-lg"
						>
							はじめる
						</a>
					{:else if guide.step?.requiresAction}
						<!-- Action-required step: show hint instead of navigation button -->
						<span class="px-2 py-1 text-xs text-blue-500 font-medium">
							<span aria-hidden="true">👆</span> やってみよう
						</span>
					{:else}
						{@const nextStep = GUIDE_STEPS[guide.currentStep + 1]}
						{#if nextStep}
							<a
								href={nextStep.href}
								class="px-3 py-1.5 bg-blue-500 text-white text-xs font-bold rounded-lg"
								onclick={handleAdvance}
							>
								つぎへ
							</a>
						{/if}
					{/if}
					<button
						type="button"
						class="p-1 text-gray-300 hover:text-gray-500 text-lg leading-none"
						onclick={handleDismiss}
						aria-label="ガイドを閉じる"
					>
						&times;
					</button>
				</div>
			</div>

			<!-- Step dots -->
			<div class="flex justify-center gap-1.5 pb-2">
				{#each GUIDE_STEPS as _, i}
					<div
						class="w-1.5 h-1.5 rounded-full transition-colors {i <= guide.currentStep ? 'bg-blue-500' : 'bg-gray-200'}"
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
