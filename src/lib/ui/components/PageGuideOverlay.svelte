<script lang="ts">
import { type Config, type Driver, type DriveStep, driver, type Side } from 'driver.js';
import { mount, unmount } from 'svelte';
import 'driver.js/dist/driver.css';
import PageGuideBubble from '$lib/ui/tutorial/PageGuideBubble.svelte';
import {
	completePageGuide,
	endPageGuide,
	getCurrentGuideInfo,
	isPageGuideActive,
} from '$lib/ui/tutorial/page-guide-store.svelte';
import type { GuideStep, PageGuide } from '$lib/ui/tutorial/page-guide-types';

const active = $derived(isPageGuideActive());
const guide = $derived(getCurrentGuideInfo());

let driverInstance: Driver | null = null;
let mountedBubble: Record<string, unknown> | null = null;
// 最終 step まで到達して閉じたか (= 完了として localStorage に永続するか) の判定フラグ。
// onDestroyed 内では driver が teardown 済で isLastStep() が信用できないため、
// destroy を呼ぶ側 (最終 step の onNext / onEnd) で確定させる。
let completedLastStep = false;
// プログラム的 teardown (store inactive / guide 切替) 中は onDestroyed の store 副作用を抑止する。
// これがないと「新 guide の startDriver → 旧 driver.destroy() → onDestroyed → endPageGuide()」で
// 起動直後の store を即座に無効化してしまう。
let suppressDestroyHook = false;

/** GuideStep.position を driver.js の Side に写像する ('auto' は viewport 自動調整に委ねる)。 */
function toSide(position: GuideStep['position']): Side {
	switch (position) {
		case 'top':
			return 'top';
		case 'left':
			return 'left';
		case 'right':
			return 'right';
		default:
			// 'auto' / 'bottom' / undefined は bottom を希望ヒントにし、収まらなければ driver.js が flip
			return 'bottom';
	}
}

/**
 * 既存 Svelte 3 タブ UI (PageGuideBubble) を driver.js popover の wrapper に mount する。
 * driver.js は positioning / scroll-into-view / spotlight cutout を担い、本体 UI は流用する (AC2)。
 */
function renderBubble(
	wrapper: HTMLElement,
	pageGuide: PageGuide,
	step: GuideStep,
	d: Driver,
): void {
	// E2E / a11y 互換: 既存 spec が参照する role / aria / class を popover wrapper に付与する。
	wrapper.classList.add('guide-overlay');
	wrapper.setAttribute('role', 'dialog');
	wrapper.setAttribute('aria-modal', 'true');
	wrapper.setAttribute('aria-labelledby', 'page-guide-title');

	if (mountedBubble) {
		unmount(mountedBubble);
		mountedBubble = null;
	}
	wrapper.replaceChildren();

	const activeIndex = d.getActiveIndex() ?? 0;
	mountedBubble = mount(PageGuideBubble, {
		target: wrapper,
		props: {
			step,
			guide: pageGuide,
			progress: { current: activeIndex + 1, total: pageGuide.steps.length },
			isFirst: d.isFirstStep(),
			isLast: d.isLastStep(),
			onEnd: () => {
				// 途中の「とじる」は未完了扱い (completedLastStep は false のまま)
				d.destroy();
			},
			onPrev: () => d.movePrevious(),
			onNext: () => {
				if (d.isLastStep()) {
					// 最終 step の「かんりょう！」= 完了として永続する
					completedLastStep = true;
					d.destroy();
				} else {
					d.moveNext();
				}
			},
		},
	});

	// selector 省略 step (= 画面中央 modal) のみ mount 後に driver.refresh() で再 positioning する。
	// driver.js は popover を ee() で「mount 前の空 wrapper 実測幅」を使い center 配置するため、
	// Svelte bubble mount 後に wrapper が最終幅 (max 360px) へ成長すると計測幅とずれ、特に CI mobile
	// (production) では left = innerWidth/2 - realWidth/2 が過小評価され右端が viewport を超える
	// (#2971: [mobile] checklists step#1 right=400.5 > 391)。element 紐付き step は driver.js の
	// collision 回避が target 基準で正しく働くため refresh は不要。中央 modal に限定して最終幅で
	// 再 center させる。
	//
	// 重要: driver.js の refresh() は be() → ne() のみ呼び、ee() (onPopoverRender を含む) は
	// 呼ばない (#2971 調査確定)。そのため refresh 後に clamp が自動的に再適用されることはなく、
	// 明示的に再実行する必要がある。
	// 実行順序:
	//   [1] d.refresh() → ne() で「Svelte bubble mount 後の正しい幅」を使い style.left/top を再計算
	//   [2] clampPopoverToViewport() で viewport 超過分を transform で補正 (#2971 根治)
	if (!step.selector && typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(() => {
			if (driverInstance === d && d.isActive()) {
				d.refresh();
				// [2] refresh は onPopoverRender を再発火しないため clamp を明示再実行する (#2971)
				const popoverWrapper = document.getElementById('driver-popover-content');
				if (popoverWrapper) clampPopoverToViewport(popoverWrapper);
			}
		});
	}
}

/**
 * render 層の viewport clamp — 構成的保証 (#2971)。
 *
 * driver.js は popover を配置する際に wrapper の measured size を使い position を決定するが、
 * CI 環境 (Linux / Pixel 7 emulation) では日本語テキストが local より高く / 広くレンダーされるため
 * 配置後の popover 辺が viewport を超えることがある。本関数は onPopoverRender hook (= driver.js が
 * 配置を完了した後に毎回発火) で wrapper の getBoundingClientRect() を計測し、viewport 境界を
 * padding 8px (stagePadding 相当) で内側に保って超過分を transform: translate で補正する。
 *
 * なぜ transform か:
 *   - driver.js の position: absolute + top/left に重ねるだけで layout flow に影響しない
 *   - driver.js が次のステップ遷移で reset するため永続的な副作用がない
 *
 * selector 省略 step (中央 modal) の rAF refresh 後の clamp 再適用について (#2971):
 *   - driver.js の refresh() = be() → ne() のみ。ee() (onPopoverRender を含む) は呼ばない。
 *   - そのため refresh 後の clamp 再適用は rAF ブロック内で明示的に行う (上部 renderBubble 参照)。
 *
 * 両立不能 (target 要素が viewport の大半を占める等、幾何的に回避不能) な場合は補正しない。
 * そのような step は invariant spec の幾何 exempt 条件 (assertBubbleNotOverlapTarget) が正しく吸収する。
 */
function clampPopoverToViewport(wrapper: HTMLElement): void {
	const rect = wrapper.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return; // まだ mount されていない

	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const pad = 8; // stagePadding と同値

	// 現在の transform を除去して素の位置を取得するため、一時的に transform をリセットする。
	// driver.js は style.transform を直接操作しないため、既存 transform は本 clamp が設定したもの。
	const prevTransform = wrapper.style.transform;
	wrapper.style.transform = '';
	const baseRect = wrapper.getBoundingClientRect();
	wrapper.style.transform = prevTransform;

	let dx = 0;
	let dy = 0;

	// 右端が viewport を超えていれば左に移動
	if (baseRect.right > vw - pad) {
		dx = vw - pad - baseRect.right;
	}
	// 左端が viewport より左なら右に移動 (右端補正後に再チェック)
	if (baseRect.left + dx < pad) {
		dx = pad - baseRect.left;
	}

	// 下端が viewport を超えていれば上に移動
	if (baseRect.bottom > vh - pad) {
		dy = vh - pad - baseRect.bottom;
	}
	// 上端が viewport より上なら下に移動 (下端補正後に再チェック)
	if (baseRect.top + dy < pad) {
		dy = pad - baseRect.top;
	}

	if (dx !== 0 || dy !== 0) {
		wrapper.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
	} else {
		wrapper.style.transform = '';
	}
}

function buildDriveSteps(pageGuide: PageGuide): DriveStep[] {
	return pageGuide.steps.map((step) => ({
		// selector 省略 step (ページ概要等) は element 無し → driver.js が画面中央 modal で表示 (Sub-2 ①概要 前提)
		element: step.selector,
		popover: {
			side: toSide(step.position),
			align: 'center',
			// title / description は空にし、custom render の Svelte UI に全面委譲する (AC2)
			showButtons: [],
			onPopoverRender: (popover, { driver: d }) => {
				// 1. Svelte bubble を driver.js wrapper に mount する
				renderBubble(popover.wrapper, pageGuide, step, d);
				// 2. mount 後に viewport clamp を適用する (#2971 render 層の構成的保証)。
				//    selector 省略 step の rAF refresh 後は onPopoverRender は再発火しないため、
				//    renderBubble の rAF ブロック内で明示的に clamp を再実行している。
				clampPopoverToViewport(popover.wrapper);
			},
		},
	}));
}

function destroyDriver(): void {
	if (mountedBubble) {
		unmount(mountedBubble);
		mountedBubble = null;
	}
	if (driverInstance) {
		const inst = driverInstance;
		driverInstance = null;
		// プログラム的 teardown: onDestroyed の store 副作用 (end/complete) を抑止して
		// driver の DOM だけ破棄する (store 状態は呼び出し元が責務を持つ)。
		suppressDestroyHook = true;
		if (inst.isActive()) inst.destroy();
		suppressDestroyHook = false;
	}
}

function startDriver(pageGuide: PageGuide): void {
	destroyDriver();
	completedLastStep = false;

	const config: Config = {
		// 演出を煽らない (ADR-0012): smoothScroll で対象を確実に画面内へ運んでから配置する。
		animate: true,
		smoothScroll: true,
		// Escape での close は許可 (allowKeyboardControl) しつつ、backdrop click では閉じない。
		// 旧実装は backdrop 矩形 click のみで閉じ、❓ 連打 (force click) では閉じなかったため、
		// その挙動を維持する (overlayClickBehavior を no-op hook にして誤 dismiss を防ぐ)。
		allowClose: true,
		overlayClickBehavior: () => {},
		// backdrop cutout (spotlight) の余白と角丸 — 視認性のため大きめに取る (AC6)
		stagePadding: 8,
		stageRadius: 12,
		overlayColor: 'rgb(0, 0, 0)',
		overlayOpacity: 0.6,
		// 対象要素はガイド中もクリック可能 (Anti-engagement: 記録→数秒で閉じる導線を阻害しない)
		disableActiveInteraction: false,
		allowKeyboardControl: true,
		popoverClass: 'page-guide-popover',
		steps: buildDriveSteps(pageGuide),
		// 最終 step まで到達して閉じたら完了 (localStorage 永続)、途中終了 (とじる / Escape /
		// overlay click) なら未完了のまま end。判定は completedLastStep フラグで行う。
		onDestroyed: () => {
			driverInstance = null;
			if (mountedBubble) {
				unmount(mountedBubble);
				mountedBubble = null;
			}
			// プログラム的 teardown (destroyDriver) 経由なら store 副作用は呼ばない。
			if (suppressDestroyHook) return;
			if (completedLastStep) completePageGuide();
			else endPageGuide();
		},
	};

	driverInstance = driver(config);
	driverInstance.drive(0);
}

// store の active 状態に追従して driver.js tour を起動 / 破棄する。
// 手動 positioning / targetRect / SVG spotlight は撤去し、driver.js に全面委譲した (AC1)。
$effect(() => {
	if (active && guide) {
		startDriver(guide);
	} else {
		destroyDriver();
	}

	return () => {
		destroyDriver();
	};
});
</script>

<style>
	/*
	  Minimal adjustments to the driver.js popover for our guide UI.
	  PageGuideBubble draws its own white card / header / nav, so we strip only the
	  default driver.js popover chrome (padding / background / box-shadow) and use the
	  wrapper as a transparent positioning container. :global overrides the elements
	  driver.js injects at body level from this component scope.
	  NOTE: do NOT use `all: unset` — it would also wipe the z-index driver.js gives
	  `.driver-popover` (above the overlay SVG), dropping the bubble behind the overlay so
	  button clicks get intercepted by the overlay SVG. Override chrome properties only.
	*/
	:global(.driver-popover.page-guide-popover) {
		/*
		  driver.js positions / viewport-clamps the popover using THIS wrapper's measured
		  width & height (`se()` → wrapper.getBoundingClientRect()). To guarantee the bubble
		  can always be placed fully inside the viewport (invariant (b)), the wrapper must
		  never be wider/taller than the viewport minus a margin. CI (Linux) renders the
		  Japanese bubble text taller than local, so a fixed 360px without a height cap let
		  driver place the popover with a negative top / off-viewport edge. We therefore cap
		  BOTH axes responsively here and make the inner bubble fill the wrapper (width 100%),
		  so the wrapper's measured size always equals the rendered bubble size and stays
		  within `100vw - 24px` × `100vh - 24px`. The bubble itself scrolls (overflow-y:auto)
		  when content exceeds the cap.
		*/
		max-width: min(360px, calc(100vw - 24px));
		max-height: calc(100vh - 24px);
		min-width: 0;
		background: transparent;
		box-shadow: none;
		padding: 0;
		margin: 0;
		border-radius: 0;
		color: inherit;
	}

	/* Hide driver.js's built-in popover UI (title / body / footer / progress / close / arrow)
	   — the UI is fully delegated to the Svelte PageGuideBubble (AC2). */
	:global(.driver-popover.page-guide-popover .driver-popover-title),
	:global(.driver-popover.page-guide-popover .driver-popover-description),
	:global(.driver-popover.page-guide-popover .driver-popover-footer),
	:global(.driver-popover.page-guide-popover .driver-popover-progress-text),
	:global(.driver-popover.page-guide-popover .driver-popover-close-btn),
	:global(.driver-popover.page-guide-popover .driver-popover-arrow) {
		display: none !important;
	}

	/*
	  Stronger spotlight ring (AC6 / PO finding c): put the box-shadow directly on the
	  .driver-active-element that driver.js applies to the highlighted element. Because it is
	  the element's own box-shadow, the ring always follows it when driver.js re-positions on
	  scroll / resize, so it never drifts. Thick blue ring + double glow + pulse make the
	  focus target obvious at a glance.
	*/
	:global(.driver-active-element) {
		border-radius: 12px;
		box-shadow:
			0 0 0 3px var(--color-action-primary),
			0 0 0 6px color-mix(in srgb, var(--color-action-primary) 35%, transparent),
			0 0 18px 4px color-mix(in srgb, var(--color-action-primary) 45%, transparent) !important;
		animation: page-guide-ring-pulse 1.8s ease-in-out infinite;
	}

	@keyframes page-guide-ring-pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 3px var(--color-action-primary),
				0 0 0 6px color-mix(in srgb, var(--color-action-primary) 30%, transparent),
				0 0 14px 3px color-mix(in srgb, var(--color-action-primary) 35%, transparent);
		}
		50% {
			box-shadow:
				0 0 0 4px var(--color-action-primary),
				0 0 0 8px color-mix(in srgb, var(--color-action-primary) 40%, transparent),
				0 0 26px 6px color-mix(in srgb, var(--color-action-primary) 55%, transparent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.driver-active-element) {
			animation: none;
		}
	}
</style>
