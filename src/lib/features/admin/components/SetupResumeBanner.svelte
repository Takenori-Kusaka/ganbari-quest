<script lang="ts">
// #2821: セットアップ離脱後の再開導線。OnboardingChecklist (/admin 専用) では届かない
// 「親が実際に着地する画面 (/switch・子供ホーム)」と「setup 由来で admin に着地したとき」
// の 2 文脈に最小サイズの再開バナーを出す。完了済み (allCompleted) なら描画しない
// (Anti-engagement ADR-0012: 進行中のみ表示)。
import { SETUP_RESUME_LABELS } from '$lib/domain/labels';
import type { OnboardingProgress } from '$lib/server/services/onboarding-service';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	onboarding: OnboardingProgress;
	/** 'resume': 着地画面で続きへ誘導 / 'context': setup 由来の admin 文脈バナー */
	variant?: 'resume' | 'context';
}

let { onboarding, variant = 'resume' }: Props = $props();

const next = $derived(onboarding.nextRecommendation);
// 再開先: 次のおすすめ step の href。無ければ /admin (チェックリスト全体) に戻す。
// resume バナーからの遷移には `from=setup` を付与し、着地した admin 画面で文脈バナー
// (variant=context) が出るようにする (「テンプレ追加で着地して迷子」の連鎖を断つ、AC2)。
// 既に query を持つ href には & で連結。/switch (子供画面確認導線) など admin 外 href には付けない。
function withFromSetup(href: string): string {
	if (!href.startsWith('/admin')) return href;
	return href.includes('?') ? `${href}&from=setup` : `${href}?from=setup`;
}
const resumeHref = $derived(
	variant === 'resume' ? withFromSetup(next?.href ?? '/admin') : (next?.href ?? '/admin'),
);
</script>

{#if !onboarding.allCompleted && !onboarding.dismissed}
	<div class="setup-resume" data-testid="setup-resume-banner" data-variant={variant} role="status">
		<span class="emoji" aria-hidden="true">{variant === 'context' ? '🧭' : '🚩'}</span>
		<div class="body">
			<p class="title">
				{variant === 'context'
					? SETUP_RESUME_LABELS.contextTitle
					: SETUP_RESUME_LABELS.resumeTitle}
			</p>
			{#if variant === 'context'}
				<p class="desc">
					{SETUP_RESUME_LABELS.contextDesc}{#if next}{SETUP_RESUME_LABELS.nextStepSuffix(
							next.label,
						)}{/if}
				</p>
			{:else}
				<p class="desc">
					{SETUP_RESUME_LABELS.progressText(
						onboarding.completedCount,
						onboarding.totalCount,
					)}{#if next}{SETUP_RESUME_LABELS.nextStepSuffix(next.label)}{/if}
				</p>
			{/if}
		</div>
		<Button
			variant="primary"
			size="sm"
			href={resumeHref}
			data-testid="setup-resume-cta"
		>
			{variant === 'context'
				? SETUP_RESUME_LABELS.backToSetupCta
				: SETUP_RESUME_LABELS.resumeCta}
		</Button>
	</div>
{/if}

<style>
	.setup-resume {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		background: var(--color-surface-info);
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
	}
	.emoji {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.title {
		margin: 0;
		font-weight: 700;
		font-size: 0.875rem;
		color: var(--color-text-primary);
	}
	.desc {
		margin: 2px 0 0 0;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
