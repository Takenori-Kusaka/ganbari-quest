<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor } from 'storybook/test';
import { OYAKAGI_LABELS } from '$lib/domain/labels';
import ParentGateReauthDialog from './ParentGateReauthDialog.svelte';

// #4866 系 / PO 決裁 2026-09-10 決定 4(a): form action が親 PIN gate で止まったとき、
// **admin 画面のまま**おやカギを入れ直すダイアログ。
//
// 実画面での撮影は原理的にできない: 親 PIN gate は cognito production でのみ有効で
// (§4.3「有効化条件」)、SS 撮影に使う demo 環境 (AUTH_MODE=anonymous + DATA_SOURCE=demo) では
// gate 自体が無効なため、このダイアログが開く状態を作れない。見た目と文言はここで見る。
const { Story } = defineMeta({
	title: 'Admin/ParentGateReauthDialog',
	component: ParentGateReauthDialog,
	tags: ['autodocs'],
});
</script>

<!--
	保存しようとしたらおやカギの確認が切れていた状態。**入力が消えていないこと**と
	**この画面のまま入れ直せること**の 2 つを伝えるのがこのダイアログの仕事。
	Ark UI の Portal で document.body 直下に出るため query は screen 起点 (tests/CLAUDE.md)。
-->
<Story
	name="Open"
	args={{ open: true, onClose: () => {} }}
	play={async () => {
		const dialog = await waitFor(() => screen.getByTestId('parent-gate-reauth-modal'));
		await expect(dialog).toBeVisible();
		// 入力が保持されている旨 (PO 決定 4(a) の主眼) が出ている
		await expect(dialog).toHaveTextContent(OYAKAGI_LABELS.gateRequiredKeepInput);
		// 画面を離れずに入れ直せる旨
		await expect(screen.getByTestId('parent-gate-reauth-hint')).toHaveTextContent(
			OYAKAGI_LABELS.gateReauthDescription,
		);
		// PIN を忘れた保護者の出口が必ずある (無いと詰む)
		await expect(screen.getByTestId('parent-gate-reauth-forgot-pin-link')).toBeVisible();
	}}
/>

<!--
	旗が立っていない状態。Ark UI の Dialog は Content を常に DOM に置き、開閉は presence で
	切り替える (`{#if}` で外さない) ため、**存在しないこと**ではなく**見えないこと**を固定する。
	保護者が普通に保存できているときに PIN 入力が顔を出さないこと、が守りたい性質。
-->
<Story
	name="Closed"
	args={{ open: false, onClose: () => {} }}
	play={async () => {
		await expect(screen.getByTestId('parent-gate-reauth-modal')).not.toBeVisible();
	}}
/>
