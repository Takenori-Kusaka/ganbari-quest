<script lang="ts">
import { APP_LABELS, PAGE_TITLES, PRICING_PAGE_LABELS } from '$lib/domain/labels';
import { getPricingFeatures, getPricingPagePlans } from '$lib/domain/plan-features';
import Card from '$lib/ui/primitives/Card.svelte';

// #765: プラン情報は $lib/domain/plan-features.ts の SSOT から取得する。
// 個別フィールドのハードコード禁止（#749 ブランドガイドライン §7）。
const plans = getPricingPagePlans().map((meta) => ({
	...meta,
	features: getPricingFeatures(meta.id),
}));
</script>

<svelte:head>
	<title>{PAGE_TITLES.pricing}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="pricing-page max-w-[960px] mx-auto py-8 px-4">
	<header class="text-center mb-10">
		<h1 class="text-[1.75rem] font-bold text-[var(--color-neutral-700)] mb-2" data-testid="pricing-heading">{PRICING_PAGE_LABELS.heading}</h1>
		<p class="text-[var(--color-neutral-500)] text-[0.95rem]">{PRICING_PAGE_LABELS.subtitle1}<strong>{PRICING_PAGE_LABELS.subtitleTrialDays}</strong>{PRICING_PAGE_LABELS.subtitle2}</p>
	</header>

	<div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-6 mb-8">
		{#each plans as plan}
			<div
				class="plan-card relative bg-[var(--color-surface-card)] border-2 rounded-2xl p-6 flex flex-col"
				class:recommended={plan.recommended}
				class:default-border={!plan.recommended}
				data-testid="pricing-plan-card"
				data-plan={plan.id}
			>
				{#if plan.badge}
					<span class="absolute -top-3 left-4 bg-[var(--color-violet-500)] text-[var(--color-text-inverse)] text-xs font-bold px-3 py-0.5 rounded-full" data-testid="pricing-badge">{plan.badge}</span>
				{/if}
				<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-2" data-testid="pricing-plan-name">{plan.name}</h2>
				<div class="mb-1">
					<span class="text-[2rem] font-bold text-[var(--color-neutral-900)]" data-testid="pricing-plan-price">{plan.price}</span>
					{#if plan.unit}
						<span class="text-[0.9rem] text-[var(--color-neutral-500)]">{plan.unit}</span>
					{/if}
				</div>
				{#if plan.yearlyPrice}
					<p class="text-[0.8rem] text-[var(--color-neutral-500)] mb-3" data-testid="pricing-yearly-price">{plan.yearlyPrice}</p>
				{:else}
					<p class="text-[0.8rem] text-[var(--color-neutral-500)] mb-3">&nbsp;</p>
				{/if}
				<p class="text-[0.85rem] text-[var(--color-neutral-500)] mb-5">{plan.shortDescription}</p>

				<a
					href={plan.ctaHref}
					class="plan-cta block text-center py-3 rounded-lg text-[0.9rem] font-semibold no-underline mb-5 transition-colors"
					class:primary={plan.id !== 'free'}
					data-testid="pricing-cta"
				>
					{plan.ctaLabel}
				</a>

				<ul class="plan-features list-none p-0 m-0 flex-1">
					{#each plan.features as feature}
						<li class="text-[0.85rem] text-[var(--color-neutral-600)] py-1.5 pl-5 relative">{feature}</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<p class="text-center text-[0.85rem] text-[var(--color-neutral-500)] mb-12">
		&#x1F4A1; {PRICING_PAGE_LABELS.featureNote}<strong>{PRICING_PAGE_LABELS.featureNoteStrong}</strong>{PRICING_PAGE_LABELS.featureNoteSuffix}
	</p>

	<Card padding="lg" class="bg-[var(--color-surface-muted)]">
		{#snippet children()}
		<h2 class="text-[1.1rem] font-semibold text-[var(--color-neutral-700)] mb-4">{PRICING_PAGE_LABELS.faqTitle}</h2>
		<dl>
			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqFreePlanQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqFreePlanA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqCancelTrialQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqCancelTrialA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqCancelQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqCancelA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqBillingDateQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqBillingDateA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqPaymentQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqPaymentA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqPlanChangeQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqPlanChangeA}</dd>

			<dt class="text-[0.9rem] font-semibold text-[var(--color-neutral-700)] mt-4">{PRICING_PAGE_LABELS.faqSelfHostQ}</dt>
			<dd class="text-[0.85rem] text-[var(--color-neutral-500)] mt-1">{PRICING_PAGE_LABELS.faqSelfHostA}</dd>
		</dl>
		{/snippet}
	</Card>
</div>

<style>
	.pricing-page {
		--color-pricing-accent: var(--color-violet-500);
		--color-pricing-accent-hover: var(--color-violet-600);
	}
	.plan-card.recommended {
		border-color: var(--color-pricing-accent);
		box-shadow: 0 4px 14px rgba(139, 92, 246, 0.15);
	}
	.plan-card.default-border {
		border-color: var(--color-border-default);
	}
	.plan-cta {
		background: var(--color-neutral-100);
		color: var(--color-neutral-700);
	}
	.plan-cta:hover {
		background: var(--color-border-default);
	}
	.plan-cta.primary {
		background: var(--color-pricing-accent);
		color: var(--color-text-inverse);
	}
	.plan-cta.primary:hover {
		background: var(--color-pricing-accent-hover);
	}
	.plan-features li::before {
		content: '\2713';
		position: absolute;
		left: 0;
		color: var(--color-success);
		font-weight: 700;
	}
</style>
