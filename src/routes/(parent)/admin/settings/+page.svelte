<script lang="ts">
// #2320 (EPIC #2319 ①): /admin/settings hub page。
// 既存 2059 行メガファイル (15 sections) を child routes 6 グループに分割し、
// 本 hub は 6 グループへのカード型ナビと grace バナーのみを表示する。
//
// Material Design / Apple HIG / NN/G Common Region 原則 + GitHub (organization >
// repo > personal 3 階層) prior art 整合。

import { page } from '$app/stores';
import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';
import { APP_LABELS, PAGE_TITLES, SETTINGS_LABELS, SETTINGS_NAV_LABELS } from '$lib/domain/labels';
import { CONCEPT_ICONS } from '$lib/domain/terms';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

// #2319: グループカードの構造化
interface GroupCard {
	href: string;
	title: string;
	desc: string;
	icon: string;
	external?: boolean;
	testid: string;
}

const groupCards: GroupCard[] = [
	{
		href: '/admin/settings/account',
		title: SETTINGS_LABELS.groupAccountTitle,
		desc: SETTINGS_LABELS.groupAccountDesc,
		icon: '🔑',
		testid: 'settings-hub-card-account',
	},
	{
		href: '/admin/settings/activities',
		title: SETTINGS_LABELS.groupActivitiesTitle,
		desc: SETTINGS_LABELS.groupActivitiesDesc,
		icon: '🎯',
		testid: 'settings-hub-card-activities',
	},
	{
		href: '/admin/settings/notifications',
		title: SETTINGS_LABELS.groupNotificationsTitle,
		desc: SETTINGS_LABELS.groupNotificationsDesc,
		icon: '🔔',
		testid: 'settings-hub-card-notifications',
	},
	{
		href: '/admin/settings/data',
		title: SETTINGS_LABELS.groupDataTitle,
		desc: SETTINGS_LABELS.groupDataDesc,
		icon: '💾',
		testid: 'settings-hub-card-data',
	},
	{
		// #3954: 実装済みの「ごほうび交換の承認要否」(#3339) / ボーナスルール ON/OFF が
		// hub から辿れず、実オーナーから「どこから変更可能ですか」と問い合わせが来た。
		// 活動・ポイント (activities) と紛らわしくならないよう、ごほうび文脈を先頭に置く。
		href: '/admin/settings/rules',
		title: SETTINGS_LABELS.groupRulesTitle,
		desc: SETTINGS_LABELS.groupRulesDesc,
		icon: CONCEPT_ICONS.reward,
		testid: 'settings-hub-card-rules',
	},
	{
		href: '/admin/settings/support',
		title: SETTINGS_LABELS.groupSupportTitle,
		desc: SETTINGS_LABELS.groupSupportDesc,
		icon: '💬',
		testid: 'settings-hub-card-support',
	},
	{
		href: '/admin/subscription',
		title: SETTINGS_LABELS.groupPlanTitle,
		desc: SETTINGS_LABELS.groupPlanDesc,
		icon: '💎',
		external: true,
		testid: 'settings-hub-card-plan',
	},
];

// #3991 / #3986: `grace_period` は **支払い失敗 (dunning) の猶予** のみを意味する。
// 解約申請中かどうかは Stripe の `cancel_at_period_end` が SSOT であり、その表示と
// 「解約を取り消す」導線は /admin/subscription (SaasLicensePanel) が担う。
// 旧実装はここに解約取り消しボタンを置いていたため、支払い失敗しただけのテナントが
// それを押して未払いのまま ACTIVE に戻せてしまっていた (#3986)。
</script>

<svelte:head>
	<title>{PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- grace_period バナー (hub にのみ表示、child routes では非表示) -->
	{#if $page.data.tenantStatus === SUBSCRIPTION_STATUS.GRACE_PERIOD}
		<div
			class="bg-[var(--color-feedback-error-bg)] border-2 border-[var(--color-feedback-error-border)] rounded-xl p-6"
			data-testid="settings-hub-grace-banner"
		>
			<h3 class="text-lg font-bold text-[var(--color-feedback-error-text)] mb-2">
				{SETTINGS_LABELS.gracePeriodTitle}
			</h3>
			<p class="text-sm text-[var(--color-feedback-error-text)] mb-4">
				{SETTINGS_LABELS.gracePeriodDesc}
			</p>
			<Button href="/admin/subscription" variant="primary" size="md">
				{SETTINGS_LABELS.gracePeriodAction}
			</Button>
		</div>
	{/if}

	<div data-tutorial="settings-hub-intro">
		<Card padding="lg">
			<h2 class="text-xl font-bold text-[var(--color-text)] mb-2">
				{SETTINGS_LABELS.hubTitle}
			</h2>
			<p class="text-sm text-[var(--color-text-muted)]">
				{SETTINGS_LABELS.hubDesc}
			</p>
		</Card>
	</div>

	<div class="settings-hub__grid" data-testid="settings-hub-grid">
		{#each groupCards as group, i (group.href)}
			<a
				href={group.href}
				class="settings-hub__card"
				data-testid={group.testid}
				data-tutorial={i === 0 ? 'settings-first-card' : undefined}
			>
				<div class="settings-hub__card-icon" aria-hidden="true">{group.icon}</div>
				<div class="settings-hub__card-body">
					<h3 class="settings-hub__card-title">
						{group.title}
						{#if group.external}
							<span class="settings-hub__card-external" aria-label={SETTINGS_NAV_LABELS.externalIndicatorHub}>↗</span>
						{/if}
					</h3>
					<p class="settings-hub__card-desc">{group.desc}</p>
				</div>
			</a>
		{/each}
	</div>
</div>

<style>
	.settings-hub__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
	}

	.settings-hub__card {
		display: flex;
		gap: 0.75rem;
		padding: 1rem;
		background: var(--color-surface-card);
		border: 1px solid var(--color-border-default);
		border-radius: 0.75rem;
		text-decoration: none;
		transition: border-color 0.15s ease, background-color 0.15s ease,
			transform 0.15s ease;
	}

	.settings-hub__card:hover {
		border-color: var(--color-border-focus);
		background: var(--color-surface-accent);
		transform: translateY(-1px);
	}

	.settings-hub__card-icon {
		flex: 0 0 auto;
		font-size: 1.75rem;
		line-height: 1;
		padding-top: 0.125rem;
	}

	.settings-hub__card-body {
		flex: 1 1 auto;
		min-width: 0;
	}

	.settings-hub__card-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.settings-hub__card-external {
		font-size: 0.75rem;
		opacity: 0.6;
	}

	.settings-hub__card-desc {
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		margin: 0;
		line-height: 1.5;
	}
</style>
