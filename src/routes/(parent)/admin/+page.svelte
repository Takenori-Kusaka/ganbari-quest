<script lang="ts">
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';

let { data } = $props();
</script>

<AdminHome
	children={data.children}
	pointSettings={data.pointSettings}
	tutorialStarted={data.tutorialStarted}
	onboarding={data.onboarding}
	mode="live"
	basePath="/admin"
/>
