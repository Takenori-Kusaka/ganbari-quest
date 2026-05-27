<script module lang="ts">
/**
 * UnifiedImportHub.stories.svelte — #2544 Storybook interaction test exemplar
 *
 * 背景 (実害): 初顧客レビュー直前、UnifiedImportHub の取込ダイアログで「追加ボタン無反応・
 *   キャンセル不能」(機能 dead-end) を発見。Storybook には UnifiedImportHub の stories が
 *   存在せず、component 層の操作回帰がゼロだった (#2544 research §1.4 / AC4)。
 *
 * 本 stories の役割 (tests/CLAUDE.md §Storybook interaction test):
 *   - play 関数で「操作 → 結果 (callback 発火 / disabled 制御)」を component 層で検証する手本。
 *   - server submit (form action → DB) は Playwright (統合層) に委ね、ここでは
 *     **「ハンドラが配線され disabled 制御が効くか」** という配線健全性に限定する (二重防御)。
 *   - play 内 expect / userEvent / fn は `storybook/test` (Storybook 10 同梱) から import。
 *   - `npm run test:storybook` (vitest --project storybook) で CI 実行される。
 *
 * 関連: #2544 / #2459 / ADR-0052 / DESIGN.md §10
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, within } from 'storybook/test';
import UnifiedImportHub from './UnifiedImportHub.svelte';

const { Story } = defineMeta({
	title: 'Marketplace/UnifiedImportHub',
	component: UnifiedImportHub,
	tags: ['autodocs'],
});

// activity-pack (childId 不要) の preset サンプル
const activityPresets = {
	'activity-pack': [{ itemId: 'kinder-starter', name: 'ようじキッズ', icon: '🧒', itemCount: 8 }],
};

// reward-set (childId 必須) の preset サンプル
const rewardPresets = {
	'reward-set': [{ itemId: 'reward-sample', name: 'ごほうびセット', icon: '🎁', itemCount: 5 }],
};
</script>

<!--
  activity-pack 単一 type モード: import ボタンが enabled で押下可能 (配線健全性)。
  dead-end (ボタンが押せない) なら toBeEnabled が fail する。
-->
<Story
	name="ActivityPackImportEnabled"
	args={{ typeCode: 'activity-pack', presets: activityPresets, onimported: fn(), onclose: fn() }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const btn = canvas.getByTestId('marketplace-preset-import-kinder-starter');
		// 配線確認: import ボタンが描画され enabled (dead-end でない前提)
		await expect(btn).toBeVisible();
		await expect(btn).toBeEnabled();
	}}
/>

<!--
  reward-set (childId 必須) で selectedChildId 未指定: import ボタンが disabled になり、
  child-hint が表示される (誤操作防止の配線確認)。
-->
<Story
	name="DisabledWhenNoChildId"
	args={{ typeCode: 'reward-set', presets: rewardPresets, onimported: fn(), onclose: fn() }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		// childId 必須 type なのに childId 無し → button disabled + child-hint visible
		await expect(canvas.getByTestId('unified-import-hub-child-hint')).toBeVisible();
		await expect(canvas.getByTestId('marketplace-preset-import-reward-sample')).toBeDisabled();
	}}
/>

<!--
  disabled prop (plan 制限 / 権限) が true のとき import ボタンが押せない (配線確認)。
-->
<Story
	name="DisabledByProp"
	args={{ typeCode: 'activity-pack', presets: activityPresets, disabled: true, onimported: fn() }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('marketplace-preset-import-kinder-starter')).toBeDisabled();
	}}
/>

<!--
  #2558 bug-1 配線健全性: import ボタンは type=submit で `?/importPack` form action に
  紐付いた <form> の内側に配置されている (= 押下で必ず form action が発火する)。
  旧 dead-end (ボタンが form に紐付かず無反応) の component 層回帰検出。
-->
<Story
	name="ImportButtonWiredToFormAction"
	args={{ typeCode: 'activity-pack', presets: activityPresets, onimported: fn(), onclose: fn() }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const btn = canvas.getByTestId('marketplace-preset-import-kinder-starter');
		// submit ボタンであること (押下で form submit が発火する前提)
		await expect(btn).toHaveAttribute('type', 'submit');
		// 親 <form> が `?/importPack` action に紐付いていること (dead-end でない構造保証)
		const form = btn.closest('form');
		await expect(form).not.toBeNull();
		await expect(form as HTMLFormElement).toHaveAttribute('action', expect.stringContaining('importPack'));
		await expect(form as HTMLFormElement).toHaveAttribute('method', 'POST');
	}}
/>
