<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import FeedbackDialog from '$lib/features/admin/components/FeedbackDialog.svelte';
import TrialBanner from '$lib/features/admin/components/TrialBanner.svelte';
import TrialEndedDialog from '$lib/features/admin/components/TrialEndedDialog.svelte';
import DebugPlanIndicator from '$lib/ui/components/DebugPlanIndicator.svelte';

interface Props {
	data: {
		isPremium?: boolean;
		planTier?: 'free' | 'standard' | 'family';
		authMode?: string;
		debugPlanSummary?: string | null;
		trialJustExpired?: boolean;
		trialStatus?: {
			isTrialActive: boolean;
			daysRemaining: number;
			trialUsed: boolean;
			trialEndDate: string | null;
		};
		archivedSummary?: {
			archivedChildCount: number;
			hasArchivedResources: boolean;
		};
	};
	children: Snippet;
}

let { data, children }: Props = $props();

const trial = $derived(data.trialStatus);
const planTier = $derived(data.planTier ?? 'free');
const showTrialBanner = $derived(
	data.authMode !== 'local' &&
		trial &&
		(trial.isTrialActive ||
			(trial.trialUsed && !trial.isTrialActive && trial.trialEndDate !== null) ||
			// #731: 未使用 free ユーザーにもトライアル開始導線を表示
			(planTier === 'free' && !trial.trialUsed && !trial.isTrialActive)),
);

// #770: トライアル終了検知 — server から trialJustExpired が来たらダイアログを表示
// $effect で一度 true になったら dismiss するまで維持する
let showTrialEndedDialog = $state(false);
$effect(() => {
	if (data.trialJustExpired) {
		showTrialEndedDialog = true;
	}
});

// #839: フィードバックダイアログ
let showFeedback = $state(false);
</script>

<AdminLayout mode="live" basePath="/admin" isPremium={data.isPremium ?? false} planTier={data.planTier ?? 'free'}>
	{#if showTrialBanner && trial}
		<div style:margin-bottom="16px">
			<TrialBanner
				isTrialActive={trial.isTrialActive}
				daysRemaining={trial.daysRemaining}
				trialUsed={trial.trialUsed}
				trialEndDate={trial.trialEndDate}
				{planTier}
				hasArchivedResources={data.archivedSummary?.hasArchivedResources ?? false}
			/>
		</div>
	{/if}
	{@render children()}
</AdminLayout>
<TrialEndedDialog
	bind:open={showTrialEndedDialog}
	onDismiss={() => { showTrialEndedDialog = false; }}
/>
<!-- #839: フィードバック FAB + ダイアログ -->
<button
	type="button"
	class="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-20
		w-12 h-12 rounded-full shadow-lg
		bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]
		flex items-center justify-center text-xl
		hover:opacity-90 transition-opacity"
	onclick={() => { showFeedback = true; }}
	aria-label="ご意見・不具合報告"
	data-testid="feedback-fab"
>
	💬
</button>
<FeedbackDialog bind:open={showFeedback} />
<DebugPlanIndicator summary={data.debugPlanSummary ?? null} />
