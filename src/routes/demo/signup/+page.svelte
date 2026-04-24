<script lang="ts">
import { APP_LABELS, DEMO_SIGNUP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import { trackDemoEvent } from '$lib/features/demo/demo-analytics.js';
import Logo from '$lib/ui/components/Logo.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

// Track conversion page view
trackDemoEvent('demo_signup_page');

function handleCtaClick() {
	trackDemoEvent('demo_cta_click', { location: 'signup_page' });
}
</script>

<svelte:head>
	<title>{PAGE_TITLES.demoSignup}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="min-h-dvh bg-gradient-to-b from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)]">	<div class="max-w-lg mx-auto px-4 py-8">		<!-- Hero -->		<div class="text-center mb-8">
			<div class="flex justify-center mb-4">
				<Logo variant="compact" size={160} />
			</div>
			<h1 class="text-2xl font-bold text-[var(--color-text)] mb-2">
				{DEMO_SIGNUP_LABELS.heroTitle}
			</h1>
			<p class="text-[var(--color-text)]">
				{DEMO_SIGNUP_LABELS.heroDesc1}<br />{DEMO_SIGNUP_LABELS.heroDesc2}
			</p>
		</div>

		<!-- Primary CTA -->
		<Card variant="elevated" padding="lg" class="border border-[var(--color-feedback-warning-border)] mb-6 text-center">
			{#snippet children()}
			<p class="text-lg font-bold text-[var(--color-text)] mb-1">{DEMO_SIGNUP_LABELS.trialHeading}</p>
			<p class="text-sm text-[var(--color-text-muted)] mb-4">{DEMO_SIGNUP_LABELS.trialSubheading}</p>
			<a
				href="/auth/signup"
				onclick={handleCtaClick}
				class="block w-full py-3 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow"			>
				{DEMO_SIGNUP_LABELS.ctaStartFree}
			
			</a>
			<p class="text-xs text-[var(--color-text-muted)] mt-2">{DEMO_SIGNUP_LABELS.ctaCancelNote}</p>
			{/snippet}
		</Card>

		<!-- Value propositions -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-4">{DEMO_SIGNUP_LABELS.featuresHeading}</h2>
			<div class="space-y-4">
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📋</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">{DEMO_SIGNUP_LABELS.feature1Title}</p>
						<p class="text-xs text-[var(--color-text-muted)]">{DEMO_SIGNUP_LABELS.feature1Desc}</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">📊</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">{DEMO_SIGNUP_LABELS.feature2Title}</p>
						<p class="text-xs text-[var(--color-text-muted)]">{DEMO_SIGNUP_LABELS.feature2Desc}</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🎯</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">{DEMO_SIGNUP_LABELS.feature3Title}</p>
						<p class="text-xs text-[var(--color-text-muted)]">{DEMO_SIGNUP_LABELS.feature3Desc}</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">👨‍👩‍👧‍👦</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">{DEMO_SIGNUP_LABELS.feature4Title}</p>
						<p class="text-xs text-[var(--color-text-muted)]">{DEMO_SIGNUP_LABELS.feature4Desc}</p>
					</div>
				</div>
				<div class="flex gap-3">
					<span class="text-2xl flex-shrink-0">🔒</span>
					<div>
						<p class="font-bold text-[var(--color-text)] text-sm">{DEMO_SIGNUP_LABELS.feature5Title}</p>
						<p class="text-xs text-[var(--color-text-muted)]">{DEMO_SIGNUP_LABELS.feature5Desc}</p>
					</div>
				</div>
			</div>
			{/snippet}
		</Card>

		<!-- Pricing summary -->
		<Card padding="lg" class="mb-6">
			{#snippet children()}
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-4">{DEMO_SIGNUP_LABELS.pricingHeading}</h2>
			<p class="text-sm text-[var(--color-text)] mb-2">
				<span class="font-bold">{DEMO_SIGNUP_LABELS.pricingFreeLabel}</span>{DEMO_SIGNUP_LABELS.pricingFreePrice}<span class="font-bold">{DEMO_SIGNUP_LABELS.pricingStandardLabel}</span>{DEMO_SIGNUP_LABELS.pricingStandardPrice}<span class="font-bold">{DEMO_SIGNUP_LABELS.pricingFamilyLabel}</span>{DEMO_SIGNUP_LABELS.pricingFamilyPrice}
			</p>
			<p class="text-xs text-[var(--color-text-muted)] mb-3">{DEMO_SIGNUP_LABELS.pricingTrialNote}</p>
			<a href="/pricing" class="block text-center text-sm text-[var(--color-brand-500)] hover:underline">
				{DEMO_SIGNUP_LABELS.pricingDetailsLink}
			</a>
			{/snippet}
		</Card>

		<!-- Testimonial / Social proof -->
		<div class="bg-gradient-to-r from-[var(--color-feedback-warning-bg)] to-[var(--color-orange-50)] rounded-2xl border border-[var(--color-feedback-warning-border)] p-6 mb-6">
			<h2 class="text-lg font-bold text-[var(--color-text)] mb-3 text-center">{DEMO_SIGNUP_LABELS.testimonialsHeading}</h2>
			<div class="space-y-3">
				<div class="bg-[var(--color-surface-card)] rounded-xl p-3">
					<p class="text-sm text-[var(--color-text)] italic">{DEMO_SIGNUP_LABELS.testimonial1}</p>
					<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">{DEMO_SIGNUP_LABELS.testimonial1Author}</p>
				</div>
				<div class="bg-[var(--color-surface-card)] rounded-xl p-3">
					<p class="text-sm text-[var(--color-text)] italic">{DEMO_SIGNUP_LABELS.testimonial2}</p>
					<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">{DEMO_SIGNUP_LABELS.testimonial2Author}</p>
				</div>
			</div>
		</div>

		<!-- Secondary CTA -->
		<div class="text-center mb-8">
			<a
				href="/auth/signup"
				class="inline-block w-full py-3 bg-gradient-to-r from-[var(--color-warning)] to-[var(--color-orange-500)] text-white font-bold rounded-xl text-center text-lg shadow-sm hover:shadow-md transition-shadow">
				{DEMO_SIGNUP_LABELS.ctaStartTrial}
			</a>
			<p class="text-xs text-[var(--color-text-muted)] mt-2">{DEMO_SIGNUP_LABELS.ctaTrialNote}</p>
		</div>

		<!-- Back to demo -->
		<div class="text-center">
			<a href="/demo" class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
				{DEMO_SIGNUP_LABELS.backToDemo}
			</a>
		</div>
	</div>
</div>
