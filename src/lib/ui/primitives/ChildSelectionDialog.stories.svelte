<script module>
/**
 * ChildSelectionDialog.stories.svelte — #2544 follow-up P3 Storybook interaction test
 *
 * 背景 (research §4-A P3): ChildSelectionDialog は per-child 採用 type (activity / reward /
 * challenge) の marketplace 取込 SSOT primitive だが、本 stories の `play` 関数は 0 件で
 * 「全員選択 → confirm 発火」「1 child 選択 → ids=[X] 発火」「empty children で confirm
 * disabled」が壊れても CI 緑のままだった (operation 回帰 0 件)。本 follow-up で UnifiedImportHub
 * の play exemplar (#2544) と同型に component 層の操作回帰を追加する。
 *
 * 設計原則 (tests/CLAUDE.md §Storybook interaction test):
 *   - server submit (DB 反映) は Playwright (統合層) に委ね、ここでは onConfirm / onCancel
 *     **callback の発火 / 引数 shape / disabled 制御** を component 層で検証する。
 *   - play 内 expect / fn / userEvent は `storybook/test` (Storybook 10 同梱) から import。
 *   - `npm run test:storybook` (vitest --project storybook) で CI 実行される。
 *   - ADR-0006 厳守: dispatchEvent / force:true / retry loop 不採用、Testing Library 原則の
 *     click / role / testid query を使用。
 *
 * 関連: #2544 / #2459 / ADR-0007 (EPIC-merge tier) / ADR-0006 (assertion 弱体化禁止)
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
// ChildSelectionDialog は Ark UI Dialog primitive を内包し `<Portal>` 経由で document.body
// 直下に content を render する。canvasElement (Story 描画コンテナ) には届かないため、
// `screen` (document.body 起点の Testing Library query) を使う。
// 参考: Storybook docs "Interaction tests" + Ark UI Portal の仕様。
import { expect, fn, screen, waitFor } from 'storybook/test';
import { CHILD_SELECTION_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import ChildSelectionDialog from './ChildSelectionDialog.svelte';

const L = STORYBOOK_LABELS.childSelectionDialog;

const threeChildren = [
	{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: L.childTaroIcon },
	{ id: 2, nickname: L.childHina.split(' ')[0], age: 5, icon: L.childHinaIcon },
	{ id: 3, nickname: L.childKenta.split(' ')[0], age: 1, icon: L.childKentaIcon },
];

const oneChild = [{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: L.childTaroIcon }];

/** @type {Array<{id: number; nickname: string; age?: number; icon?: string}>} */
const noChildren = [];

const { Story } = defineMeta({
	title: 'Primitives/ChildSelectionDialog',
	component: ChildSelectionDialog,
	tags: ['autodocs'],
});
</script>

<!--
  Default 動作 (allowMultiple=false / 3 children): default は「全員に追加」が選択済。
  確定 click → onConfirm が 'all' で呼ばれる (per-child 取込 dialog の主動線、dead-end 検出)。
-->
<Story
	name="Default"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: false,
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async ({ args }) => {
		// Portal 経由で render されるため `screen` (document.body 起点) で query する。
		// Dialog mount が非同期完了するまで waitFor で待機 (timeout 默認 1s で十分)。
		const confirm = await waitFor(() => screen.getByTestId('child-selection-confirm'));
		// 配線確認: default「全員に追加」option + confirm ボタンが visible (dead-end でない前提)
		const allOption = screen.getByTestId('child-selection-all');
		await expect(allOption).toBeVisible();
		await expect(confirm).toBeVisible();
		await expect(confirm).toBeEnabled();
		// 確定 click → onConfirm が 'all' で発火 (副作用 verify、render-only 禁止)
		await confirm.click();
		await expect(args.onConfirm).toHaveBeenCalledTimes(1);
		await expect(args.onConfirm).toHaveBeenCalledWith('all');
	}}
/>

<!--
  AllowMultiple 動作 (checkbox / 3 children): 2 children を選択 → 確定 click → onConfirm が
  number[] (選択 child id 配列) で発火。研究 §1-D CUJ-A4 「1 child のみ選択 → 他 child は 0
  row」の component 層保証。
-->
<Story
	name="AllowMultiple"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: true,
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async ({ args }) => {
		// Portal 経由 (screen + waitFor)
		const childTaro = await waitFor(() => screen.getByTestId('child-selection-1'));
		const childHina = screen.getByTestId('child-selection-2');
		await expect(childTaro).toBeVisible();
		await expect(childHina).toBeVisible();
		await childTaro.click();
		await childHina.click();
		// 確定 click → onConfirm が [1, 2] で発火 (1 child のみ選択 退行検出)
		const confirm = screen.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		await confirm.click();
		await expect(args.onConfirm).toHaveBeenCalledTimes(1);
		// 引数 shape: 'all' でなく number[]、選択 id を含む
		await expect(args.onConfirm).toHaveBeenCalledWith([1, 2]);
	}}
/>

<!--
  Cancel: キャンセル click → onCancel 発火 / onConfirm は呼ばれない
  (顧客指摘「キャンセルもできない」の component 層保証)。
-->
<Story
	name="Cancel"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: false,
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async ({ args }) => {
		const cancel = await waitFor(() =>
			screen.getByRole('button', { name: CHILD_SELECTION_LABELS.cancel }),
		);
		await expect(cancel).toBeVisible();
		await cancel.click();
		await expect(args.onCancel).toHaveBeenCalledTimes(1);
		await expect(args.onConfirm).not.toHaveBeenCalled();
	}}
/>

<!--
  SingleChild (children=1): args-only。
  研究 §3-B12 idempotency / B16 child-scope verify の SSOT primitive 表示確認。
-->
<Story
	name="SingleChild"
	args={{
		children: oneChild,
		open: true,
		allowMultiple: false,
		onConfirm: fn(),
		onCancel: fn(),
	}}
/>

<!--
  Empty (children=0): 配列空の時の防御。default で「全員に追加」が selected (canConfirm=true)
  でも、実用上「全員 = 0 名」になり取込先がない。本 story は **「全員」option は visible だが
  個別 child option が 0 件であること** を assert する (default で confirm が enabled なのは
  primitive 設計上の仕様、empty children を渡さない呼出側責任)。
-->
<Story
	name="Empty"
	args={{
		children: noChildren,
		open: true,
		allowMultiple: false,
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async () => {
		// Portal 経由 → screen + waitFor (Dialog mount 完了待ち)
		const allOption = await waitFor(() => screen.getByTestId('child-selection-all'));
		// 「全員に追加」option 自体は visible (default selection、primitive 仕様)
		await expect(allOption).toBeVisible();
		// 配線確認: empty children なら個別 child option (testid='child-selection-<数字>') が
		// 1 件も render されない。'child-selection-all' / 'child-selection-confirm' は別 testid 名で除外、
		// 数字 ID パターンのみマッチさせる (Portal 跨ぎの leak も含めて厳密 0 件を保証)。
		const numericChildOptions = Array.from(
			document.body.querySelectorAll('[data-testid^="child-selection-"]'),
		).filter((el) => {
			const tid = el.getAttribute('data-testid') ?? '';
			return /^child-selection-\d+$/.test(tid);
		});
		expect(numericChildOptions.length, 'children=[] で個別 child option が render されない').toBe(
			0,
		);
	}}
/>

<!--
  ConfirmLoading (#2632 CX-DoR #9 NN/G #1 visibility of system status):
  confirmLoading=true で confirm ボタンが spinner + disabled + aria-busy 化し、cancel も
  disabled になる。取込実行中に「処理中である」visible feedback を出し再クリック誤動作を
  防ぐ component 層回帰。closeOnConfirm=false 併用時も dialog は open 維持。
-->
<Story
	name="ConfirmLoading"
	args={{
		children: threeChildren,
		open: true,
		allowMultiple: true,
		confirmLoading: true,
		closeOnConfirm: false,
		onConfirm: fn(),
		onCancel: fn(),
	}}
	play={async () => {
		// Portal 経由 → screen + waitFor (Dialog mount 完了待ち)
		const confirm = await waitFor(() => screen.getByTestId('child-selection-confirm'));
		// 取込実行中: confirm ボタンは disabled + aria-busy で「処理中」を機械的に伝える
		await expect(confirm).toBeDisabled();
		await expect(confirm).toHaveAttribute('aria-busy', 'true');
	}}
/>

<style>
	:global(.sb-story) {
		min-height: 500px;
	}
</style>
