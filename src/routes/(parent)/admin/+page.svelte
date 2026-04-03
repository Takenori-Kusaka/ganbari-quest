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
	monthlySummaries={data.monthlySummaries}
	currentMonth={data.currentMonth}
	planTier={data.planTier}
	planStats={data.planStats}
	showPremiumWelcome={data.showPremiumWelcome}
	seasonalInfo={data.seasonalInfo}
/>
