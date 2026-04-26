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
	showPremiumWelcome={data.showPremiumWelcome}
	seasonalInfo={data.seasonalInfo}
	planStats={data.planStats}
	trialStatus={data.trialStatus}
	stripeEnabled={data.stripeEnabled}
	todayUsage={data.todayUsage}
/>
