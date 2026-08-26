<script lang="ts">
// #4644: 「ホーム画面に追加」のプラットフォーム別手順。
//
// バナー (PwaInstallBanner) の吹き出しと 設定 > サポート の恒久導線が同じ手順を出すため、
// 描画を 1 箇所に集約する。片方だけ直して実画面に届かない事故 (#4176 と同型) を避ける。
import { PWA_INSTALL_LABELS } from '$lib/domain/labels';
import type { PwaInstallPlatform } from './pwa-install';

interface Props {
	/** 'ios' / 'android' はその手順のみ、'other' は両方を並べる (どちらの端末か確定できないため) */
	platform?: PwaInstallPlatform;
	testid?: string;
}

let { platform = 'other', testid = 'pwa-install-guide' }: Props = $props();

const showAndroid = $derived(platform !== 'ios');
const showIos = $derived(platform !== 'android');
</script>

<div class="pwa-guide" data-testid={testid}>
	<p class="pwa-guide__intro">{PWA_INSTALL_LABELS.guideIntro}</p>

	{#if showAndroid}
		<section class="pwa-guide__block" data-testid="pwa-install-guide-android">
			<h4 class="pwa-guide__title">{PWA_INSTALL_LABELS.androidTitle}</h4>
			<ol class="pwa-guide__steps">
				<li>{PWA_INSTALL_LABELS.androidStep1}</li>
				<li>{PWA_INSTALL_LABELS.androidStep2}</li>
				<li>{PWA_INSTALL_LABELS.androidStep3}</li>
			</ol>
		</section>
	{/if}

	{#if showIos}
		<section class="pwa-guide__block" data-testid="pwa-install-guide-ios">
			<h4 class="pwa-guide__title">{PWA_INSTALL_LABELS.iosTitle}</h4>
			<ol class="pwa-guide__steps">
				<li>{PWA_INSTALL_LABELS.iosStep1}</li>
				<li>{PWA_INSTALL_LABELS.iosStep2}</li>
				<li>{PWA_INSTALL_LABELS.iosStep3}</li>
			</ol>
		</section>
	{/if}

	<p class="pwa-guide__note">{PWA_INSTALL_LABELS.afterNote}</p>
</div>

<style>
	.pwa-guide {
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
	}

	.pwa-guide__intro,
	.pwa-guide__note {
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.pwa-guide__block {
		border: 1px solid var(--color-border-light);
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		background: var(--color-surface-muted);
	}

	.pwa-guide__title {
		margin: 0 0 0.5rem;
		font-size: 0.9375rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.pwa-guide__steps {
		margin: 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		font-size: 0.875rem;
		line-height: 1.7;
		color: var(--color-text-secondary);
		list-style: decimal;
	}
</style>
