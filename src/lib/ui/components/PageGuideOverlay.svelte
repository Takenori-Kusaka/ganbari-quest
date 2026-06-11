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
// 恒常 rAF clamp ループのハンドル (#2971 round4)。
// ガイド表示中はフレーム毎に clamp を適用し、driver.js の scroll/resize 再配置を含む
// あらゆる再配置経路を構成的に被覆する (onPopoverRender 非発火の再配置も補正される)。
let clampLoopId: number | null = null;

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

	// mount 直後に .guide-bubble へ runtime px maxWidth を適用する (#2971 round5)。
	// CSS `max-width: min(360px, calc(100vw - 24px))` が CI 二重 emulation (412px) で 388px に
	// 評価されるため、window.innerWidth 基準の確実な値を直接 style に書き込む。
	// 恒常 rAF ループ (clampPopoverFrame) が毎フレーム同値を再設定するが、mount 直後の
	// 初期フレームで値を確定させることで driver.refresh() 再計測時の幅整合を担保する。
	const pad = 8;
	const initialBubble = wrapper.querySelector<HTMLElement>('.guide-bubble');
	if (initialBubble) {
		initialBubble.style.maxWidth = `${Math.min(360, window.innerWidth - 2 * pad)}px`;
	}

	// selector 省略 step (= 画面中央 modal) のみ mount 後に driver.refresh() で再 positioning する。
	// driver.js は popover を ee() で「mount 前の空 wrapper 実測幅」を使い center 配置するため、
	// Svelte bubble mount 後に wrapper が最終幅 (max 360px) へ成長すると計測幅とずれ、特に CI mobile
	// (production) では left = innerWidth/2 - realWidth/2 が過小評価され右端が viewport を超える
	// (#2971: [mobile] checklists step#1 right=400.5 > 391)。element 紐付き step は driver.js の
	// collision 回避が target 基準で正しく働くため refresh は不要。中央 modal に限定して最終幅で
	// 再 center させる。
	//
	// 重要: driver.js の refresh() は be() → ne() のみ呼び、ee() (onPopoverRender を含む) は
	// 呼ばない (#2971 調査確定)。refresh 後の clamp 補正は恒常 rAF ループが次フレームで担う。
	if (!step.selector && typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(() => {
			if (driverInstance === d && d.isActive()) {
				d.refresh();
				// refresh 後の clamp 補正は恒常 rAF ループ (startClampLoop) が次フレームで担う (#2971 round4)
			}
		});
	}
}

/**
 * 恒常 rAF clamp ループ — 構成的保証 (#2971 round4)。
 *
 * 【確定機序 (#2971 round4)】
 * driver.js は scroll / resize イベントで popover を自前再配置する際、onPopoverRender を発火しない
 * (be() → ne() のみ)。そのため step 遷移時の smoothScroll 後の再配置で一発 clamp (#2972/#2976/#2978)
 * が上書きされ、未 clamp 位置のまま「安定」して計測される。CI は font metrics 差で scroll 発生量が
 * 変わり local と乖離する。
 *
 * 【解法: rAF ループによる恒常 clamp】
 * ガイド表示中はフレーム毎に clamp 条件をチェックし、超過があれば補正する。
 * driver.js の scroll/resize/refresh どの再配置後も次フレームで補正されるため、
 * spec の stable 待ちは「clamp 済み安定」を観測する設計になる。
 *
 * 【incremental delta 方式】
 * transform をリセットせず現在の rect を計測し、viewport 超過分だけ既存 translate に加算する。
 * リセット方式は per-frame flicker を生むため採用しない。
 * clamp はべき等 (超過なしなら何もしない = no-op)。収束後は実質的にコストゼロ。
 *
 * 【width clamp — 計測対象は .guide-bubble (#2971 round5 確定)】
 * round2-4 では wrapper (driver-popover-content) に maxWidth を適用していたが、
 * invariant spec の計測対象は内側の Svelte 子要素 `.guide-bubble` であるため
 * wrapper clamp は計測値に届かなかった (right=400.5 が全 round 不変だった理由)。
 * CSS `max-width: min(360px, calc(100vw - 24px))` の `100vw` は CI 二重 emulation 環境
 * (project=mobile layout 412px → invariant spec が 390px resize) で 388px に評価され、
 * x≈12.5 + 388 = 400.5 と完全一致する。
 * → runtime px 値を `.guide-bubble` 自身の style.maxWidth に直接設定し、
 *   位置 clamp の計測対象も `.guide-bubble` rect に変更する (計測対象の一致が本質)。
 *   translate は wrapper に適用で OK (bubble は子として追従)。
 */

/** rAF ループの 1 フレーム処理: incremental delta 方式で popover を viewport 内に clamp する。 */
function clampPopoverFrame(wrapper: HTMLElement): void {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const pad = 8; // stagePadding と同値

	// --- runtime px 幅 clamp を .guide-bubble に適用 (#2971 round5 確定) ---
	// spec 計測対象 = .guide-bubble、wrapper 計測では届かない (#2971 round5 確定)。
	// wrapper (driver-popover-content) への maxWidth 適用では .guide-bubble の CSS
	// `max-width: min(360px, calc(100vw - 24px))` が CI 二重 emulation で 388px に評価され
	// right=400.5 が不変のまま全 round で失敗した根本原因。
	const bubble = wrapper.querySelector<HTMLElement>('.guide-bubble');
	if (bubble) {
		bubble.style.maxWidth = `${Math.min(360, vw - 2 * pad)}px`;
	}

	// 計測対象は .guide-bubble (= spec と同一要素)。bubble 未 mount なら wrapper で fallback。
	const measureTarget = bubble ?? wrapper;
	const rect = measureTarget.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) return; // まだ mount されていない

	// --- incremental delta 方式 translate clamp ---
	// 現在の rect (既存 translate 込み) を計測し、超過分だけ translate に加算する。
	// transform リセットなしで計測するため per-frame flicker が発生しない。
	// 計測対象は .guide-bubble (= spec と同一要素) を使用する (#2971 round5 確定)。

	let addDx = 0;
	let addDy = 0;

	// 右端が viewport を超えていれば左に追加移動
	if (rect.right > vw - pad) {
		addDx = vw - pad - rect.right;
	}
	// 左端が viewport より左なら右に追加移動 (右端補正後に再チェック)
	if (rect.left + addDx < pad) {
		addDx = pad - rect.left;
	}

	// 下端が viewport を超えていれば上に追加移動
	if (rect.bottom > vh - pad) {
		addDy = vh - pad - rect.bottom;
	}
	// 上端が viewport より上なら下に追加移動 (下端補正後に再チェック)
	if (rect.top + addDy < pad) {
		addDy = pad - rect.top;
	}

	if (addDx === 0 && addDy === 0) return; // 超過なし → no-op (べき等)

	// 既存 translate を解析して加算する
	const existingTransform = wrapper.style.transform;
	let existingDx = 0;
	let existingDy = 0;
	if (existingTransform) {
		const match = existingTransform.match(/translate\(([^,]+)px,\s*([^)]+)px\)/);
		if (match) {
			existingDx = parseFloat(match[1] ?? '0') || 0;
			existingDy = parseFloat(match[2] ?? '0') || 0;
		}
	}

	wrapper.style.transform = `translate(${Math.round(existingDx + addDx)}px, ${Math.round(existingDy + addDy)}px)`;
}

/**
 * ガイド表示中の恒常 rAF clamp ループを開始する。
 * driver.js の scroll/resize/refresh による再配置 (onPopoverRender 非発火) を含む
 * あらゆる再配置経路を構成的に被覆する (#2971 round4)。
 */
function startClampLoop(getWrapper: () => HTMLElement | null): void {
	stopClampLoop();
	const tick = () => {
		const wrapper = getWrapper();
		if (wrapper) clampPopoverFrame(wrapper);
		clampLoopId = requestAnimationFrame(tick);
	};
	clampLoopId = requestAnimationFrame(tick);
}

/** ガイド close / destroy 時に rAF ループを停止する (リーク防止)。 */
function stopClampLoop(): void {
	if (clampLoopId !== null) {
		cancelAnimationFrame(clampLoopId);
		clampLoopId = null;
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
				// per-step で前 step の clamp delta を破棄 (#2971 round4 QM 指摘)
				// driver が直前に fresh 配置した直後なので、前 step の incremental translate が
				// 残留すると新 step の popover が旧 delta 分オフセットして表示される潜在要因になる。
				popover.wrapper.style.transform = '';
				// 1. Svelte bubble を driver.js wrapper に mount する
				renderBubble(popover.wrapper, pageGuide, step, d);
				// 2. 恒常 rAF clamp ループを開始する (#2971 round4)。
				//    driver.js の scroll/resize 再配置は onPopoverRender を再発火しないため、
				//    一発 clamp では scroll 後の再配置位置が補正されないまま「安定」してしまう。
				//    ループによる恒常 clamp は全再配置経路を構成的に被覆する。
				//    wrapper は driver.js 内部 id (`driver-popover-content`) の getElementById でなく
				//    onPopoverRender が渡す popover.wrapper を直接参照する (#2982 / #2971 cleanup —
				//    内部 id 命名への依存を撤去)。destroy 後は isConnected=false で no-op になり、
				//    ループ自体も destroyDriver → stopClampLoop で停止する (二重防御)。
				const { wrapper } = popover;
				startClampLoop(() => (wrapper.isConnected ? wrapper : null));
			},
		},
	}));
}

function destroyDriver(): void {
	// rAF ループを最初に停止してリークを防ぐ (#2971 round4)
	stopClampLoop();
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

		  NOTE (#2971 round5): The CSS `max-width: min(360px, calc(100vw - 24px))` here applies
		  to the wrapper (driver-popover-content), but the invariant spec measures the inner
		  `.guide-bubble` element. In CI double-emulation (project=mobile layout 412px, then
		  invariant spec resizes to 390px), `100vw` evaluates to 412px → 388px max-width,
		  causing right≈12.5+388=400.5 > 390 invariant failure across all rounds.
		  The runtime fix is applied in clampPopoverFrame() + renderBubble() via
		  `bubble.style.maxWidth = Math.min(360, innerWidth-2*pad)px` on the .guide-bubble
		  directly. This CSS fallback remains for initial load before JS runs.
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
