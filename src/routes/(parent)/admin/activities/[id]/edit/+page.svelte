<script lang="ts">
import { APP_LABELS, ACTIVITY_PRIORITY_FORM_LABELS as P } from '$lib/domain/labels';
import ActivityEditForm from '$lib/features/admin/components/ActivityEditForm.svelte';

let { data, form } = $props();
</script>

<svelte:head>
	<title>{P.editPageTitle}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h1 class="text-lg font-bold">{P.editPageTitle}</h1>
		<a
			href="/admin/activities"
			class="text-xs text-[var(--color-text-link)] hover:underline"
			data-testid="activity-edit-back"
		>
			{P.editBackButton}
		</a>
	</div>

	{#if form?.error}
		<div class="rounded-md bg-[var(--color-feedback-error-bg)] border border-[var(--color-feedback-error-border)] p-3 text-sm text-[var(--color-feedback-error-text)]">
			{form.error}
		</div>
	{/if}

	<!-- #3499: edit/1 → edit/2 の非アンマウント再遷移 (同一 route の param 変更は component を
	     remount しない) で seed-once $state が古い activity を指す stale form を防ぐため、
	     activity.id を key に ActivityEditForm を必ず remount して再 seed する。 -->
	{#key data.activity.id}
		<ActivityEditForm activity={data.activity} categoryDefs={data.categoryDefs} />
	{/key}
</div>
