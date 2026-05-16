<script lang="ts">
import { page } from '$app/state';
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';

let { data } = $props();

// ADR-0048 Phase B-1 (#2097): demo Lambda (AUTH_MODE=anonymous) では
// `(parent)/admin/+page.svelte` も isDemo=true として描画される。
// hooks.server.ts が locals.isDemo=true をセットし、+layout.server.ts が
// $page.data.isDemo に伝搬。本 page は AdminHome の `mode` prop に橋渡しすることで、
// shared コンポーネントの `isDemo = mode === 'demo'` 派生を server-side SSOT と同期させる。
// これにより onboarding ダイアログ等の本番専用 UI が demo Lambda 上で誤表示されない (A-6 ISSUE-003)。
const adminMode = $derived<'live' | 'demo'>(page.data.isDemo ? 'demo' : 'live');
</script>

<AdminHome
	children={data.children}
	pointSettings={data.pointSettings}
	tutorialStarted={data.tutorialStarted}
	onboarding={data.onboarding}
	mode={adminMode}
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
	weeklyUsage={data.weeklyUsage}
	valuePreview={data.valuePreview}
/>
