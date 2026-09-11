<script lang="ts">
// #4644: 「ホーム画面に追加」案内バナーの見た目だけを持つ presentational component。
//
// 表示可否の判定 (standalone / 閉じた履歴 / `beforeinstallprompt`) は `PwaInstallPrompt.svelte`
// が担う。分離しているのは、判定がブラウザ環境依存 (installable な context でしか
// `beforeinstallprompt` が発火しない) で、そのままだと Storybook / SS 撮影で一度も描画されず
// 見た目のレビューができないため。
import { PWA_INSTALL_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';

interface Props {
	/** ブラウザ標準のインストールダイアログを起動できるか (Chromium 系で true) */
	canInstall: boolean;
	/** 「ホーム画面に追加」押下 (canInstall=true のとき) */
	onInstall: () => void;
	/** 「追加方法をみる」押下 (canInstall=false のとき) */
	onHowTo: () => void;
	/** 「閉じる」押下 (以後この端末では出さない) */
	onDismiss: () => void;
}

let { canInstall, onInstall, onHowTo, onDismiss }: Props = $props();
</script>

<!-- role="status" は「今すぐ対処が要る警告」ではない案内であることを表す (ADR-0062 整合)。 -->
<div class="pwa-banner" role="status" data-testid="pwa-install-banner">
	<span class="pwa-banner__icon" aria-hidden="true">📲</span>
	<div class="pwa-banner__body">
		<p class="pwa-banner__title">{PWA_INSTALL_LABELS.bannerTitle}</p>
		<p class="pwa-banner__text">{PWA_INSTALL_LABELS.bannerBody}</p>
		<div class="pwa-banner__actions">
			{#if canInstall}
				<Button
					variant="primary"
					size="sm"
					onclick={onInstall}
					data-testid="pwa-install-banner-install"
				>
					{PWA_INSTALL_LABELS.bannerInstallAction}
				</Button>
			{:else}
				<Button
					variant="outline"
					size="sm"
					onclick={onHowTo}
					data-testid="pwa-install-banner-howto"
				>
					{PWA_INSTALL_LABELS.bannerHowToAction}
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				onclick={onDismiss}
				aria-label={PWA_INSTALL_LABELS.bannerDismissAria}
				data-testid="pwa-install-banner-dismiss"
			>
				{PWA_INSTALL_LABELS.bannerDismiss}
			</Button>
		</div>
	</div>
</div>

<style>
	.pwa-banner {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 16px;
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-border-accent);
		border-radius: 0.75rem;
		background: var(--color-surface-info);
	}

	.pwa-banner__icon {
		font-size: 1.25rem;
		line-height: 1.6;
	}

	.pwa-banner__body {
		flex: 1;
		min-width: 0;
	}

	.pwa-banner__title {
		margin: 0 0 0.25rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.pwa-banner__text {
		margin: 0;
		font-size: 0.8125rem;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.pwa-banner__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
</style>
