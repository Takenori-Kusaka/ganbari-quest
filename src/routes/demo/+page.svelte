<script lang="ts">
import { goto } from '$app/navigation';
import { DEMO_TOP_LABELS } from '$lib/domain/labels';
import { trackDemoEvent } from '$lib/features/demo/demo-analytics.js';
import {
	GUIDE_STEPS,
	getGuideState,
	resetGuide,
	restartGuide,
	startGuide,
} from '$lib/features/demo/demo-guide-state.svelte.js';
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let { data } = $props();

const guide = getGuideState();

// Reset guide state when navigating back to /demo top
// This clears the overlay so it doesn't persist on the top page
$effect(() => {
	resetGuide();
});

// #702: ガイド開始は <a href> + onclick ではなく <button> + 明示 goto() で行う。
// <a href onclick={handleGuideStart}> を使うと、handleGuideStart 内の startGuide()
// で `guide.active` が true になった瞬間に layout の DemoGuideBar が表示され、
// そのレイアウトシフトと SvelteKit のリンクナビゲーションが競合してナビゲーションが
// 失われる（URL が /demo のまま残る）ケースが Playwright で再現する。
// state 変更前にターゲット URL を確定し、明示的に goto() する。
function handleGuideStart() {
	const targetHref = GUIDE_STEPS[0]?.href ?? '/demo/preschool/home?childId=902';
	startGuide();
	trackDemoEvent('demo_guide_start');
	goto(targetHref);
}

function handleGuideRestart() {
	const targetHref = GUIDE_STEPS[0]?.href ?? '/demo/preschool/home?childId=902';
	restartGuide();
	trackDemoEvent('demo_guide_start', { restart: true });
	goto(targetHref);
}

const modeLabels: Record<string, string> = {
	baby: DEMO_TOP_LABELS.modeBaby,
	preschool: DEMO_TOP_LABELS.modePreschool,
	elementary: DEMO_TOP_LABELS.modeElementary,
	junior: DEMO_TOP_LABELS.modeJunior,
	senior: DEMO_TOP_LABELS.modeSenior,
};

// #703: カードカラーは child.theme（個別画面のテーマカラー）と一致させる。
// uiMode ベースだと「ピンクテーマのはなこが green カードで表示」のような不整合が起きる。
// 個別画面と完全一致させるため `data-theme={child.theme}` を付与し、
// app.css の [data-theme="..."] で定義された --theme-300/--theme-400 を利用する。
// （Tailwind の named color を routes/ で使うとデザイントークンルール違反になるため）
</script>

<div class="min-h-dvh bg-gradient-to-b from-amber-50 to-orange-50">
	<div class="max-w-2xl mx-auto px-4 py-8">
		<!-- Hero -->
		<div class="text-center mb-8">
			<div class="flex items-center justify-center gap-2 mb-2">
				<Logo variant="compact" size={180} />
			</div>
			<p class="text-xl font-semibold text-[var(--color-text-secondary)]">{DEMO_TOP_LABELS.heroSubtitle}</p>
			<p class="text-[var(--color-text-secondary)]">
				{DEMO_TOP_LABELS.heroDesc}
			</p>
		</div>

		<!-- Guided demo option -->
		<div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-[var(--color-feedback-info-border)] p-5 mb-6 text-center">
			{#if guide.dismissed}
				<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">{DEMO_TOP_LABELS.guideDismissedTitle}</p>
				<p class="text-xs text-[var(--color-text-muted)] mb-3">{DEMO_TOP_LABELS.guideDismissedDesc}</p>
				<button
					type="button"
					class="block w-full py-2.5 bg-[var(--color-stat-blue)] text-white font-bold rounded-xl text-sm hover:bg-[var(--color-action-primary-hover)] transition-colors"
					onclick={handleGuideRestart}
					data-testid="demo-guide-restart"
				>
					{DEMO_TOP_LABELS.guideRestartButton}
				</button>
			{:else}
				<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">{DEMO_TOP_LABELS.guideFirstTimeTitle}</p>
				<p class="text-xs text-[var(--color-text-muted)] mb-3">{DEMO_TOP_LABELS.guideStepsDesc(GUIDE_STEPS.length)}</p>
				<button
					type="button"
					class="block w-full py-2.5 bg-[var(--color-stat-blue)] text-white font-bold rounded-xl text-sm hover:bg-[var(--color-action-primary-hover)] transition-colors"
					onclick={handleGuideStart}
					data-testid="demo-guide-start-link"
				>
					{DEMO_TOP_LABELS.guideStartButton}
				</button>
			{/if}
		</div>

		<!-- Family Introduction -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-4">{DEMO_TOP_LABELS.familyTitle}</h2>
			<div class="grid grid-cols-2 gap-3">
				{#each data.children as child}
					{@const mode = child.uiMode ?? 'preschool'}
					{@const label = modeLabels[mode] ?? mode}
					{@const theme = child.theme ?? 'admin'}
					<a
						href="/demo/{mode}/home?childId={child.id}"
						data-theme={theme}
						class="block rounded-xl p-4 bg-gradient-to-br from-[var(--theme-400)] to-[var(--theme-300)] text-white shadow-sm hover:shadow-md transition-shadow"
					>
						<!--
							#703: 全員「人物の顔」スタイルで統一する。
							baby → 👶 / 幼児女子 → 👧 / 小学男子 → 👦 / 中学女子 → 👩 / 高校男子 → 👨
							（旧実装は 💪 が混在しており「1人だけアイコンが違う」指摘があった）
						-->
						<div class="text-2xl mb-1">
							{#if mode === 'baby'}
								👶
							{:else if mode === 'preschool'}
								👧
							{:else if mode === 'elementary'}
								👦
							{:else if mode === 'junior'}
								👩
							{:else}
								👨
							{/if}
						</div>
						<div class="font-bold text-lg">{child.nickname}</div>
						<div class="text-sm opacity-90">{DEMO_TOP_LABELS.childAgeModeLabel(child.age, label)}</div>
					</a>
				{/each}
			</div>
			{/snippet}
		</Card>

		<!-- Admin Link -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-3">{DEMO_TOP_LABELS.adminTitle}</h2>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">
				{DEMO_TOP_LABELS.adminDesc}
			</p>
			<a
				href="/demo/admin"
				class="block w-full text-center py-3 bg-[var(--color-stat-blue)] text-white font-bold rounded-xl hover:bg-[var(--color-action-primary-hover)] transition-colors"
			>
				{DEMO_TOP_LABELS.adminButton}
			</a>
			{/snippet}
		</Card>

		<!-- Feature highlights -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text-primary)] mb-4">{DEMO_TOP_LABELS.featuresTitle}</h2>
			<ul class="space-y-3 text-sm text-[var(--color-text-secondary)]">
				<li class="flex gap-2">
					<span class="text-lg">📋</span>
					<div>
						<span class="font-medium text-[var(--color-text-primary)]">{DEMO_TOP_LABELS.feature1Title}</span>
						{DEMO_TOP_LABELS.feature1Desc}
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">⭐</span>
					<div>
						<span class="font-medium text-[var(--color-text-primary)]">{DEMO_TOP_LABELS.feature2Title}</span>
						{DEMO_TOP_LABELS.feature2Desc}
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">👥</span>
					<div>
						<span class="font-medium text-[var(--color-text-primary)]">{DEMO_TOP_LABELS.feature3Title}</span>
						{DEMO_TOP_LABELS.feature3Desc}
					</div>
				</li>
				<li class="flex gap-2">
					<span class="text-lg">🎯</span>
					<div>
						<span class="font-medium text-[var(--color-text-primary)]">{DEMO_TOP_LABELS.feature4Title}</span>
						{DEMO_TOP_LABELS.feature4Desc}
					</div>
				</li>
			</ul>
			{/snippet}
		</Card>

		<!-- Conversion CTA -->
		<div class="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl border border-orange-200 p-6 text-center">
			<p class="text-sm font-bold text-[var(--color-text-primary)] mb-1">{DEMO_TOP_LABELS.ctaTitle}</p>
			<p class="text-xs text-[var(--color-text-muted)] mb-3">{DEMO_TOP_LABELS.ctaNote}</p>
			<a
				href="/demo/signup"
				class="block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-sm"
			>
				{DEMO_TOP_LABELS.ctaButton}
			</a>
		</div>
	</div>
</div>
