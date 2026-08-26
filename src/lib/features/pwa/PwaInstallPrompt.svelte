<script lang="ts">
// #4644: 親ダッシュボード (/admin) の「ホーム画面に追加」案内。表示判定 + 手順ダイアログ。
//
// ADR-0012 (anti-engagement) 整合の押し付けない設計:
//   - 表示は /admin の 1 画面のみ。子供画面には一切出さない
//   - [閉じる] を押した端末には二度と出さない (localStorage、pwa-install.ts が SSOT)
//   - インストール完了 (`appinstalled`) でも二度と出さない
//   - 常時 FAB 等の恒常露出は作らない。恒久導線は 設定 > サポート の 1 箇所
import { PWA_INSTALL_LABELS } from '$lib/domain/labels';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import PwaInstallBanner from './PwaInstallBanner.svelte';
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

// 初期値は「出さない」側に倒す。判定はクライアント mount 後にしかできないため、
// SSR 出力にバナーを含めてしまうと hydration 直後に消える点滅になる。
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
	<PwaInstallBanner
		canInstall={deferredPrompt !== null}
		onInstall={install}
		onHowTo={() => {
			guideOpen = true;
		}}
		onDismiss={close}
	/>
{/if}

<Dialog
	bind:open={guideOpen}
	title={PWA_INSTALL_LABELS.guideTitle}
	size="lg"
	testid="pwa-install-guide-dialog"
>
	<PwaInstallGuide {platform} testid="pwa-install-guide-dialog-body" />
</Dialog>
