<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, within } from 'storybook/test';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import VisibilityChipGroup from './VisibilityChipGroup.svelte';

const L = STORYBOOK_LABELS.visibilityChipGroup;

const threeChildren = [
	{ id: 1, nickname: L.childTaro.split(' ')[0], age: 8, icon: '👦' },
	{ id: 2, nickname: L.childHina.split(' ')[0], age: 5, icon: '👧' },
	{ id: 3, nickname: L.childKenta.split(' ')[0], age: 1, icon: '👶' },
];

const allVisible = { 1: true, 2: true, 3: true };
const mixedVisibility = { 1: true, 2: true, 3: false };
const allHidden = { 1: false, 2: false, 3: false };

// play 用 spy (CX-DoR #8): chip toggle / 全員 OFF ショートカットの onToggle 発火を検証する。
const toggleSpy = fn();
const shortcutSpy = fn();

const { Story } = defineMeta({
	title: 'Primitives/VisibilityChipGroup',
	component: VisibilityChipGroup,
	tags: ['autodocs'],
});
</script>

<!--
  Default (all visible): chip id=1 を click → onToggle(1, false) 発火 (個別 toggle 健全性、
  CX-DoR #8)。VisibilityChipGroup は canvasElement 内に render されるため within を使う。
-->
<Story
	name="Default"
	args={{
		children: threeChildren,
		visibility: allVisible,
		onToggle: toggleSpy,
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const chip1 = canvas.getByTestId('visibility-chip-1');
		// all visible 時、chip は aria-pressed=true (表示中)
		await expect(chip1).toHaveAttribute('aria-pressed', 'true');
		await chip1.click();
		// click → onToggle(childId=1, visible=false) で発火 (toggle off)
		await expect(toggleSpy).toHaveBeenCalledWith(1, false);
	}}
/>

<!--
  MixedVisibility (1,2=ON / 3=OFF): 「全員 OFF」ショートカット click → ON の child (1,2) 分だけ
  onToggle(id, false) が発火する (3 は既に OFF なので呼ばれない、CX-DoR #8 一括操作健全性)。
-->
<Story
	name="MixedVisibility"
	args={{
		children: threeChildren,
		visibility: mixedVisibility,
		onToggle: shortcutSpy,
	}}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const allOff = canvas.getByTestId('visibility-shortcut-all-off');
		// mixed (ON あり) なので「全員 OFF」は enabled
		await expect(allOff).toBeEnabled();
		await allOff.click();
		// ON の child 1, 2 のみ onToggle(id, false)。OFF の child 3 は呼ばれない。
		await expect(shortcutSpy).toHaveBeenCalledWith(1, false);
		await expect(shortcutSpy).toHaveBeenCalledWith(2, false);
		await expect(shortcutSpy).toHaveBeenCalledTimes(2);
	}}
/>

<Story
	name="AllHidden"
	args={{
		children: threeChildren,
		visibility: allHidden,
		onToggle: () => {},
	}}
/>

<Story
	name="WithoutShortcuts"
	args={{
		children: threeChildren,
		visibility: mixedVisibility,
		onToggle: () => {},
		showShortcuts: false,
	}}
/>

<Story
	name="SingleChild"
	args={{
		children: [threeChildren[0]],
		visibility: { 1: true },
		onToggle: () => {},
	}}
/>

<style>
	:global(.sb-story) {
		min-height: 200px;
	}
</style>
