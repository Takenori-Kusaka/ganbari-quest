<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import SetupResumeBanner from '$lib/features/admin/components/SetupResumeBanner.svelte';
import TrialBanner from '$lib/features/admin/components/TrialBanner.svelte';
import TrialEndedDialog from '$lib/features/admin/components/TrialEndedDialog.svelte';
import type { OnboardingProgress } from '$lib/server/services/onboarding-service';
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
		// #2821: setup 由来遷移 (`?from=setup`) 時のみ非 null
		setupOnboarding?: OnboardingProgress | null;
	};
	children: Snippet;
}

let { data, children }: Props = $props();

const trial = $derived(data.trialStatus);
const planTier = $derived(data.planTier ?? 'free');
// #3033: trial active 中の残日数は header pill (AdminLayout) で常時視認させる。
// body バナーは行動喚起が必要な 3 状態のみ: urgent (残 ≤1 日) / expired / 未使用 free の開始導線
const showTrialBanner = $derived(
	data.authMode !== 'local' &&
		trial &&
		((trial.isTrialActive && trial.daysRemaining <= 1) ||
			(trial.trialUsed && !trial.isTrialActive && trial.trialEndDate !== null) ||
			// #731: 未使用 free ユーザーにもトライアル開始導線を表示
			(planTier === 'free' && !trial.trialUsed && !trial.isTrialActive)),
);
// #3033: header pill 用 (trial 非 active 時は null で非表示)
const trialDaysRemaining = $derived(trial?.isTrialActive ? trial.daysRemaining : null);

// #770: トライアル終了検知 — server から trialJustExpired が来たらダイアログを表示
// $effect で一度 true になったら dismiss するまで維持する
let showTrialEndedDialog = $state(false);
$effect(() => {
	if (data.trialJustExpired) {
		showTrialEndedDialog = true;
	}
});

// #2904: 旧 #839 FeedbackFab (右下常設バルーン) は撤去。フィードバック導線は
// 設定 > サポート (/admin/settings/support) の単独 SSOT (PO 判断: 各ページには不要)。
</script>

<AdminLayout mode="live" basePath="/admin" isPremium={data.isPremium ?? false} planTier={data.planTier ?? 'free'} authMode={data.authMode} {trialDaysRemaining}>
	<!-- #2821: setup 由来で admin に着地したときの文脈バナー (続きの step へ戻る導線) -->
	{#if data.setupOnboarding}
		<div style:margin-bottom="16px">
			<SetupResumeBanner onboarding={data.setupOnboarding} variant="context" />
		</div>
	{/if}
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
<DebugPlanIndicator summary={data.debugPlanSummary ?? null} />
