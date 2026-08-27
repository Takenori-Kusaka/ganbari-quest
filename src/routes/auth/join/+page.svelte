<script lang="ts">
import { resolve } from '$app/paths';
import { APP_LABELS, PAGE_TITLES } from '$lib/domain/labels';
import JoinBlockedCard from '$lib/features/auth/JoinBlockedCard.svelte';

let { data, form } = $props();
</script>

<svelte:head>
	<title>{PAGE_TITLES.join}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="join-bg">
	<JoinBlockedCard
		message={data.message}
		createFailed={form?.createFailed === true}
		switchAccountHref={resolve('/auth/logout')}
	/>
</div>

<style>
	.join-bg {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 1rem;
		background: var(--gradient-brand);
	}
</style>
