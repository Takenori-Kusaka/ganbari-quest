<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import SetupResumeBanner from '$lib/features/admin/components/SetupResumeBanner.svelte';
import TrialBanner from '$lib/features/admin/components/TrialBanner.svelte';
import TrialEndedDialog from '$lib/features/admin/components/TrialEndedDialog.svelte';
import { startParentGateInactivityRedirect } from '$lib/features/admin/parent-gate-inactivity';
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
		// parent-gate inactivity redirect 起動フラグ (PIN gate 有効時のみ true)
		pinGateActive?: boolean;
		// #3291: ADR-0040 実行モード (`+layout.server.ts` が locals.runtimeMode を配布)。
		// AdminLayout へ橋渡しし、NUC で SaaS 専用ガイド手順を除外するために使う。
		runtimeMode?: string;
	};
	children: Snippet;
}

let { data, children }: Props = $props();

// parent-gate inactivity redirect: PIN gate 有効時のみ、15 分アイドルで親 session を logout し
// /switch (子供選択画面) へ自動リダイレクトする。放置画面を子供が触れない本来の意図を、
// 「固める」のでなく「子供選択画面に戻す」挙動で達成する (ユーザ報告: 放置でタイムアウト→操作不能)。
$effect(() => {
	if (!data.pinGateActive) return;
	return startParentGateInactivityRedirect({
		onTimeout: async () => {
			try {
				await fetch('/api/v1/parent-gate/logout', { method: 'POST' });
			} catch {
				// logout 失敗時も /switch には戻す (server session は遅くとも 15 分で失効する)
			}
			window.location.href = '/switch?timedOut=1';
		},
	});
});

const trial = $derived(data.trialStatus);
// #3033 (PO 指摘 2026-06-12): body バナーは urgent (trial 残 1 日以下) のみ。
// 残日数 = header pill / 開始導線 = /admin/subscription / 期限切れ = TrialEndedDialog (#770)。
// 全ページ常設の販促バナーは無料版ユーザーの不利益になるため置かない (ADR-0012 準用)
const showTrialBanner = $derived(
	data.authMode !== 'local' && trial && trial.isTrialActive && trial.daysRemaining <= 1,
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

<AdminLayout mode="live" basePath="/admin" isPremium={data.isPremium ?? false} planTier={data.planTier ?? 'free'} authMode={data.authMode} {trialDaysRemaining} runtimeMode={data.runtimeMode}>
	<!-- #2821: setup 由来で admin に着地したときの文脈バナー (続きの step へ戻る導線) -->
	{#if data.setupOnboarding}
		<div style:margin-bottom="16px">
			<SetupResumeBanner onboarding={data.setupOnboarding} variant="context" />
		</div>
	{/if}
	{#if showTrialBanner && trial}
		<div style:margin-bottom="16px">
			<TrialBanner isTrialActive={trial.isTrialActive} daysRemaining={trial.daysRemaining} />
		</div>
	{/if}
	{@render children()}
</AdminLayout>
<TrialEndedDialog
	bind:open={showTrialEndedDialog}
	onDismiss={() => { showTrialEndedDialog = false; }}
/>
<DebugPlanIndicator summary={data.debugPlanSummary ?? null} />
