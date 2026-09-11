<script module>
/**
 * PwaInstallBanner.stories.svelte — #4644
 *
 * 実画面 (`/admin`) のバナーは **installable な context でしか描画されない** (Chromium が
 * `beforeinstallprompt` を発火する条件を満たす必要がある / iOS Safari 実機である必要がある)。
 * SS 撮影に使う環境では原理的に出ないため、見た目と操作の確認は本 story が担う
 * (`src/routes/CLAUDE.md` §SS 取得手順 の `ss-render-impossible` と同じ位置づけ)。
 *
 * 検証するのは配線 (click → callback 発火 / canInstall による CTA 出し分け) のみ。
 * 「一度閉じたら二度と出さない」判定は `tests/unit/features/pwa-install.test.ts` が持つ。
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn } from 'storybook/test';
import PwaInstallBanner from './PwaInstallBanner.svelte';

const { Story } = defineMeta({
	title: 'Features/Pwa/PwaInstallBanner',
	component: PwaInstallBanner,
	tags: ['autodocs'],
});
</script>

<!--
  Android / Chrome: `beforeinstallprompt` を捕捉済み。primary CTA でブラウザ標準の
  インストールダイアログを起動する。
-->
<Story
	name="CanInstall"
	args={{
		canInstall: true,
		onInstall: fn(),
		onHowTo: fn(),
		onDismiss: fn(),
	}}
	play={async ({ canvas, args }) => {
		const install = canvas.getByTestId('pwa-install-banner-install');
		await expect(install).toBeVisible();
		// canInstall=true のときは手順ボタンを出さない (CTA を 2 つ並べない)
		await expect(canvas.queryByTestId('pwa-install-banner-howto')).toBeNull();
		await install.click();
		await expect(args.onInstall).toHaveBeenCalledTimes(1);
	}}
/>

<!--
  iOS Safari 等: `beforeinstallprompt` が存在しないため、手順ダイアログを開く導線にする。
-->
<Story
	name="HowToOnly"
	args={{
		canInstall: false,
		onInstall: fn(),
		onHowTo: fn(),
		onDismiss: fn(),
	}}
	play={async ({ canvas, args }) => {
		const howTo = canvas.getByTestId('pwa-install-banner-howto');
		await expect(howTo).toBeVisible();
		await expect(canvas.queryByTestId('pwa-install-banner-install')).toBeNull();
		await howTo.click();
		await expect(args.onHowTo).toHaveBeenCalledTimes(1);
	}}
/>

<!--
  閉じる: ADR-0012 の「一度閉じたら二度と出さない」の入口。callback が発火しないと
  親が dismiss を記録できず、案内が出続ける (押し付けになる)。
-->
<Story
	name="Dismiss"
	args={{
		canInstall: true,
		onInstall: fn(),
		onHowTo: fn(),
		onDismiss: fn(),
	}}
	play={async ({ canvas, args }) => {
		const dismiss = canvas.getByTestId('pwa-install-banner-dismiss');
		await expect(dismiss).toBeVisible();
		await dismiss.click();
		await expect(args.onDismiss).toHaveBeenCalledTimes(1);
		// 閉じる操作で install が誤発火しないこと (誤って両方呼ぶ配線ミスの検出)
		await expect(args.onInstall).not.toHaveBeenCalled();
	}}
/>
