<script lang="ts">
// #4644: 親ダッシュボード (/admin) の「ホーム画面に追加」案内バナー。
//
// ADR-0012 (anti-engagement) 整合の押し付けない設計:
//   - 表示は /admin の 1 画面のみ。子供画面には一切出さない
//   - [閉じる] を押した端末には二度と出さない (localStorage、pwa-install.ts が SSOT)
//   - インストール完了 (`appinstalled`) でも二度と出さない
//   - 常時 FAB 等の恒常露出は作らない。恒久導線は 設定 > サポート の 1 箇所
import { PWA_INSTALL_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import PwaInstallGuide from './PwaInstallGuide.svelte';
import {
	type BeforeInstallPromptEvent,
	detectPwaPlatform,
	dismissPwaBanner,
	isPwaBannerDismissed,
	isStandaloneDisplay,
	type PwaInstallPlatform,
	shouldShowInstallBanner,
} from './pwa-install';

interface Props {
	/**
	 * バナーを出してよい局面か (呼び出し側が判断)。
	 * /admin では「お子さま登録が 1 人以上 = セットアップ済み」を条件にする。
	 * 登録前の親に追加を勧めても、追加した先が空の画面になるため。
	 */
	enabled?: boolean;
}

let { enabled = true }: Props = $props();

let dismissed = $state(false);
let standalone = $state(true);
let platform = $state<PwaInstallPlatform>('other');
let deferredPrompt = $state<BeforeInstallPromptEvent | null>(null);
let guideOpen = $state(false);

const visible = $derived(
	enabled &&
		shouldShowInstallBanner({
			standalone,
			dismissed,
			platform,
			hasNativePrompt: deferredPrompt !== null,
		}),
);

$effect(() => {
	// クライアントでのみ判定する (SSR では localStorage / matchMedia が無い)。
	standalone = isStandaloneDisplay(window);
	dismissed = isPwaBannerDismissed(window.localStorage);
	platform = detectPwaPlatform(navigator.userAgent);

	const onBeforeInstallPrompt = (event: Event) => {
		// 既定の mini-infobar を止めて、こちらの案内バナー経由で出す (Chromium 推奨パターン)。
		event.preventDefault();
		deferredPrompt = event as BeforeInstallPromptEvent;
	};
	const onAppInstalled = () => {
		deferredPrompt = null;
		dismissPwaBanner(window.localStorage);
		dismissed = true;
	};

	window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
	window.addEventListener('appinstalled', onAppInstalled);
	return () => {
		window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
		window.removeEventListener('appinstalled', onAppInstalled);
	};
});

function close(): void {
	dismissPwaBanner(window.localStorage);
	dismissed = true;
}

async function install(): Promise<void> {
	const prompt = deferredPrompt;
	if (!prompt) {
		guideOpen = true;
		return;
	}
	// prompt() は 1 回しか使えない。呼んだ時点で参照を捨てる。
	deferredPrompt = null;
	await prompt.prompt();
	const choice = await prompt.userChoice;
	if (choice.outcome === 'accepted') {
		// `appinstalled` が来ない環境もあるためここでも記録する。
		close();
	}
}
</script>

{#if visible}
	<!-- role="status" は「今すぐ対処が要る警告」ではない案内であることを表す (ADR-0062 整合)。 -->
	<div class="pwa-banner" role="status" data-testid="pwa-install-banner">
		<span class="pwa-banner__icon" aria-hidden="true">📲</span>
		<div class="pwa-banner__body">
			<p class="pwa-banner__title">{PWA_INSTALL_LABELS.bannerTitle}</p>
			<p class="pwa-banner__text">{PWA_INSTALL_LABELS.bannerBody}</p>
			<div class="pwa-banner__actions">
				{#if deferredPrompt}
					<Button
						variant="primary"
						size="sm"
						onclick={install}
						data-testid="pwa-install-banner-install"
					>
						{PWA_INSTALL_LABELS.bannerInstallAction}
					</Button>
				{:else}
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							guideOpen = true;
						}}
						data-testid="pwa-install-banner-howto"
					>
						{PWA_INSTALL_LABELS.bannerHowToAction}
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="sm"
					onclick={close}
					aria-label={PWA_INSTALL_LABELS.bannerDismissAria}
					data-testid="pwa-install-banner-dismiss"
				>
					{PWA_INSTALL_LABELS.bannerDismiss}
				</Button>
			</div>
		</div>
	</div>
{/if}

<Dialog
	bind:open={guideOpen}
	title={PWA_INSTALL_LABELS.guideTitle}
	size="lg"
	testid="pwa-install-guide-dialog"
>
	<PwaInstallGuide {platform} testid="pwa-install-guide-dialog-body" />
</Dialog>

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
