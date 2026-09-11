<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { SETUP_NOSCRIPT_LABELS } from '$lib/domain/labels';
import SetupNoScriptNotice from './SetupNoScriptNotice.svelte';

// PO 決裁 2026-09-10 決定 7: セットアップの選択画面 (パック / ごほうび / ルール) を
// JavaScript 無しで開いた顧客への案内。
//
// 中身は `<noscript>` なので、**JavaScript が動いている環境では原理的に描画されない**
// (Storybook も実画面も同じ)。ここでは文言そのものが SSOT を経由していること、
// および「何が必要か」と「次の一手」が両方入っていることを固定する。
const { Story } = defineMeta({
	title: 'UI/SetupNoScriptNotice',
	component: SetupNoScriptNotice,
	tags: ['autodocs'],
});
</script>

<!--
	`<noscript>` の中身は JS 有効時に描画されないため、DOM に**出ていないこと**が正しい。
	文言の妥当性は SSOT (SETUP_NOSCRIPT_LABELS) 側で担保する。
-->
<Story
	name="Default"
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// JS が動いている = この案内は出さない (出たら二重案内になる)
		await expect(canvas.queryByTestId('setup-noscript-notice')).toBeNull();

		// 文言は SSOT の 3 点セット: 何が必要か / どうすればよいか / 有効にできない場合の逃げ道
		await expect(SETUP_NOSCRIPT_LABELS.title.length).toBeGreaterThan(0);
		await expect(SETUP_NOSCRIPT_LABELS.body).toContain('JavaScript');
		await expect(
			SETUP_NOSCRIPT_LABELS.fallback.length,
			'有効にできない顧客を行き止まりにしないための一文が要る',
		).toBeGreaterThan(0);
	}}
/>
