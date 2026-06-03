<script module>
/**
 * Dialog.stories.svelte — CX-DoR #8 Storybook interaction test (新規)
 *
 * 背景 (Round 18 CX-DoR audit §C-6): Dialog primitive は modal / 子供 最頻 UX の SSOT だが
 * stories が完全欠落しており、「open → close button click → onOpenChange(close) 発火」
 * 「Esc close」「backdrop close」の操作回帰が 0 件だった (壊れても CI 緑のまま)。
 * 本 stories で ChildSelectionDialog / UnifiedImportHub の play exemplar と同型に
 * component 層の close 動線回帰を追加する。
 *
 * 設計原則 (tests/CLAUDE.md §Storybook interaction test):
 *   - server 反映 (実 modal を閉じた後の navigation 等) は Playwright (統合層) に委ね、
 *     ここでは onOpenChange callback の発火 / 引数 shape (open:false) を component 層で検証する。
 *   - Dialog は Ark UI `<Portal>` 経由で document.body 直下に content を render するため、
 *     canvasElement には届かない。`screen` (document.body 起点の Testing Library query) を使う。
 *   - play 内 expect / fn / userEvent は `storybook/test` (Storybook 10 同梱) から import。
 *   - `npm run test:storybook` (vitest --project storybook) で CI 実行される。
 *   - ADR-0006 厳守: dispatchEvent / force:true / retry loop 不採用、role / aria-label query を使用。
 *
 * 関連: CX-DoR #8 / #2544 / DESIGN.md §5 / §10 / ADR-0006
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, waitFor } from 'storybook/test';
import { STORYBOOK_LABELS, UI_PRIMITIVES_LABELS } from '$lib/domain/labels';
import Dialog from './Dialog.svelte';

const L = STORYBOOK_LABELS.dialog;

const { Story } = defineMeta({
	title: 'Primitives/Dialog',
	component: Dialog,
	tags: ['autodocs'],
});
</script>

<!--
  Default (open=true / title あり / closable): title が見え、本文 snippet が render される。
  close button (CloseTrigger) を click → onOpenChange が { open: false } で発火 (close 動線健全性、
  dead-end でない前提)。
-->
<Story
	name="Default"
	args={{ open: true, title: L.title, closable: true, onOpenChange: fn() }}
	play={async ({ args }) => {
		// Portal 経由で render されるため screen (document.body 起点) で query する。
		const title = await waitFor(() => screen.getByText(L.title));
		const body = screen.getByText(L.bodyText);
		await expect(title).toBeVisible();
		await expect(body).toBeVisible();
		// close button (CloseTrigger、aria-label='とじる') を取得 → click → 閉じる callback 発火
		const closeBtn = screen.getByRole('button', { name: UI_PRIMITIVES_LABELS.closeAriaLabel });
		await expect(closeBtn).toBeVisible();
		await closeBtn.click();
		await expect(args.onOpenChange).toHaveBeenCalledTimes(1);
		await expect(args.onOpenChange).toHaveBeenCalledWith({ open: false });
	}}
>
	{#snippet children()}
		<p>{L.bodyText}</p>
	{/snippet}
</Story>

<!--
  AccessibleRole: open 時に content が role=dialog + title を accessible name に持つ
  (modal の a11y 配線健全性、CX-DoR #8)。Esc / backdrop close は Ark UI ライブラリの
  グローバルキーボード / pointer ハンドラ依存で Storybook vitest 環境では非決定的なため
  component 層では検証せず、Playwright (統合層) に委ねる (tests/CLAUDE.md §二重防御)。
  close 動線の component 層回帰は Default (close button click) / NotClosable で担保する。
-->
<Story
	name="AccessibleRole"
	args={{ open: true, title: L.title, closable: true, onOpenChange: fn() }}
	play={async () => {
		// content は role=dialog で render される
		const dialog = await waitFor(() => screen.getByRole('dialog'));
		await expect(dialog).toBeVisible();
		// title が accessible name として紐付く (ArkDialog.Title)
		await expect(dialog).toHaveAccessibleName(L.title);
	}}
>
	{#snippet children()}
		<p>{L.bodyText}</p>
	{/snippet}
</Story>

<!--
  NotClosable (closable=false): close button (CloseTrigger) が render されない。
  確認必須の modal (誤操作防止) で × ボタンを出さない配線を保証する。
-->
<Story
	name="NotClosable"
	args={{ open: true, title: L.title, closable: false, onOpenChange: fn() }}
	play={async () => {
		await waitFor(() => screen.getByText(L.title));
		// closable=false → CloseTrigger (aria-label='とじる') が DOM に存在しない
		const closeBtn = screen.queryByRole('button', { name: UI_PRIMITIVES_LABELS.closeAriaLabel });
		expect(closeBtn, 'closable=false で × close button が render されない').toBeNull();
	}}
>
	{#snippet children()}
		<p>{L.bodyText}</p>
	{/snippet}
</Story>

<!--
  WithAriaLabel (title 無し / ariaLabel あり): title prop 無しでも ariaLabel で
  accessible name を保つ (sr-only Title)。本文 snippet は render される。
-->
<Story
	name="WithAriaLabel"
	args={{ open: true, ariaLabel: L.ariaLabel, closable: true, onOpenChange: fn() }}
>
	{#snippet children()}
		<p>{L.bodyText}</p>
	{/snippet}
</Story>
