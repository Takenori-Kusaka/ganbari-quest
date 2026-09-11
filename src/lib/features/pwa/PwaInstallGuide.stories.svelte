<script module>
/**
 * PwaInstallGuide.stories.svelte — #4644
 *
 * 手順の描画は「バナーの手順ダイアログ」と「設定 > サポートの折りたたみ」の 2 箇所から
 * 使われる。片方だけ直して実画面に届かない事故 (#4176 と同型) を避けるため描画は本
 * component 1 箇所に集約しており、その出し分け (platform prop) を story で固定する。
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect } from 'storybook/test';
import PwaInstallGuide from './PwaInstallGuide.svelte';

const { Story } = defineMeta({
	title: 'Features/Pwa/PwaInstallGuide',
	component: PwaInstallGuide,
	tags: ['autodocs'],
});
</script>

<!-- 端末が確定できないとき (デスクトップ等) は両方の手順を並べる。 -->
<Story
	name="BothPlatforms"
	args={{ platform: 'other' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('pwa-install-guide-android')).toBeVisible();
		await expect(canvas.getByTestId('pwa-install-guide-ios')).toBeVisible();
	}}
/>

<!-- Android と確定していれば iOS 手順は出さない (読む量を増やさない)。 -->
<Story
	name="Android"
	args={{ platform: 'android' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('pwa-install-guide-android')).toBeVisible();
		await expect(canvas.queryByTestId('pwa-install-guide-ios')).toBeNull();
	}}
/>

<!-- iOS と確定していれば Android 手順は出さない。 -->
<Story
	name="Ios"
	args={{ platform: 'ios' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByTestId('pwa-install-guide-ios')).toBeVisible();
		await expect(canvas.queryByTestId('pwa-install-guide-android')).toBeNull();
	}}
/>
