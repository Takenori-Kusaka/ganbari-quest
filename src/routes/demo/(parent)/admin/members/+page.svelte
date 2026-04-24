<script lang="ts">
import { APP_LABELS, DEMO_MEMBERS_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
</script>

<svelte:head>
	<title>{PAGE_TITLES.members}{APP_LABELS.demoPageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<!-- QRコード共有の説明 -->
	<Card>
		<h3 class="text-lg font-bold text-[var(--color-text-primary)] mb-3">{DEMO_MEMBERS_LABELS.sectionTitle}</h3>
		<p class="text-sm text-[var(--color-text-muted)] mb-4">
			{DEMO_MEMBERS_LABELS.sectionDesc}
		</p>

		<!-- QRコードプレビュー -->
		<div class="bg-[var(--color-surface-muted)] rounded-lg p-6 text-center">
			<div class="w-32 h-32 mx-auto bg-white border-2 border-dashed border-[var(--color-border-strong)] rounded-lg flex items-center justify-center mb-3">
				<span class="text-4xl text-[var(--color-text-disabled)]">📱</span>
			</div>
			<p class="text-xs text-[var(--color-text-tertiary)]">{DEMO_MEMBERS_LABELS.qrPlaceholder}</p>
		</div>
	</Card>

	<!-- メンバー一覧プレビュー -->
	<Card>
		<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-3">{DEMO_MEMBERS_LABELS.invitedMembersTitle}</h3>
		<div class="space-y-2">
			<div class="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] rounded-lg">
				<span class="text-2xl">👨</span>
				<div class="flex-1">
					<p class="text-sm font-bold text-[var(--color-text-primary)]">{DEMO_MEMBERS_LABELS.demoMember1Name}</p>
					<p class="text-xs text-[var(--color-text-tertiary)]">{DEMO_MEMBERS_LABELS.demoMember1Role}</p>
				</div>
				<span class="text-xs text-[var(--color-feedback-success-text)] font-bold">{DEMO_MEMBERS_LABELS.memberStatusActive}</span>
			</div>
			<div class="flex items-center gap-3 p-3 bg-[var(--color-surface-muted)] rounded-lg">
				<span class="text-2xl">👩</span>
				<div class="flex-1">
					<p class="text-sm font-bold text-[var(--color-text-primary)]">{DEMO_MEMBERS_LABELS.demoMember2Name}</p>
					<p class="text-xs text-[var(--color-text-tertiary)]">{DEMO_MEMBERS_LABELS.demoMember2Role}</p>
				</div>
				<span class="text-xs text-[var(--color-feedback-success-text)] font-bold">{DEMO_MEMBERS_LABELS.memberStatusActive}</span>
			</div>
		</div>
	</Card>

	<!-- 権限説明 -->
	<Card>
		<h3 class="text-sm font-bold text-[var(--color-text-primary)] mb-2">{DEMO_MEMBERS_LABELS.permissionsTitle}</h3>
		<ul class="text-xs text-[var(--color-text-muted)] space-y-1.5">
			<li>&#x2022; <span class="font-bold">{DEMO_MEMBERS_LABELS.permissionOwner}</span>: {DEMO_MEMBERS_LABELS.permissionOwnerDesc}</li>
			<li>&#x2022; <span class="font-bold">{DEMO_MEMBERS_LABELS.permissionMember}</span>: {DEMO_MEMBERS_LABELS.permissionMemberDesc}</li>
			<li>&#x2022; {DEMO_MEMBERS_LABELS.inviteLimit}</li>
		</ul>
	</Card>

	<DemoCta
		title={DEMO_MEMBERS_LABELS.ctaTitle}
		description={DEMO_MEMBERS_LABELS.ctaDesc}
	/>
</div>
