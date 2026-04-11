<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import TrialBanner from '$lib/features/admin/components/TrialBanner.svelte';
import DebugPlanIndicator from '$lib/ui/components/DebugPlanIndicator.svelte';

interface Props {
	data: {
		isPremium?: boolean;
		planTier?: 'free' | 'standard' | 'family';
		authMode?: string;
		debugPlanSummary?: string | null;
		trialStatus?: {
			isTrialActive: boolean;
			daysRemaining: number;
			trialUsed: boolean;
			trialEndDate: string | null;
		};
	};
	children: Snippet;
}

let { data, children }: Props = $props();

const trial = $derived(data.trialStatus);
const showTrialBanner = $derived(
	data.authMode !== 'local' &&
		trial &&
		(trial.isTrialActive ||
			(trial.trialUsed && !trial.isTrialActive && trial.trialEndDate !== null)),
);
</script>

<AdminLayout mode="live" basePath="/admin" isPremium={data.isPremium ?? false} planTier={data.planTier ?? 'free'}>
	{#if showTrialBanner && trial}
		<div style:margin-bottom="16px">
			<TrialBanner
				isTrialActive={trial.isTrialActive}
				daysRemaining={trial.daysRemaining}
				trialUsed={trial.trialUsed}
				trialEndDate={trial.trialEndDate}
			/>
		</div>
	{/if}
	{@render children()}
</AdminLayout>
<DebugPlanIndicator summary={data.debugPlanSummary ?? null} />
