<script lang="ts">
// #4448: 動いたポイント (`+10P` / `-30P`) を出発点からヘッダー残高へ飛ばす ghost。
// (child)/+layout.svelte に 1 つだけ置く。pointer-events:none なので演出中も操作できる。

import { pointFlight } from './point-flight.svelte';
import { POINT_FLIGHT_FLY_MS } from './point-flight-plan';

const ghost = $derived(pointFlight.ghost);
let flyEl = $state<HTMLElement | null>(null);

$effect(() => {
	const g = ghost;
	const node = flyEl;
	if (!g || !node) return;

	const dx = g.to.x - g.from.x;
	const dy = g.to.y - g.from.y;

	// Web Animations API で 1 回だけ飛ばす。element.animate が無い環境 (jsdom 等) では即完了扱い。
	if (typeof node.animate !== 'function') {
		pointFlight.finishGhost();
		return;
	}

	const animation = node.animate(
		[
			{ transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
			{ transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.5)`, opacity: 0.2 },
		],
		{ duration: POINT_FLIGHT_FLY_MS, easing: 'cubic-bezier(0.34, 0, 0.2, 1)', fill: 'forwards' },
	);

	let cancelled = false;
	animation.finished
		.then(() => {
			if (!cancelled) pointFlight.finishGhost();
		})
		.catch(() => {
			/* cancel 時は cleanup 側で処理済み */
		});

	return () => {
		cancelled = true;
		animation.cancel();
	};
});
</script>

{#if ghost}
	<div class="pf-layer" aria-hidden="true" data-testid="point-flight-ghost">
		<div bind:this={flyEl} class="pf-fly" style:left="{ghost.from.x}px" style:top="{ghost.from.y}px">
			<span class="pf-label" class:pf-spend={ghost.tone === 'spend'}>{ghost.label}</span>
		</div>
	</div>
{/if}

<style>
	.pf-layer {
		position: fixed;
		inset: 0;
		pointer-events: none;
		/* Dialog (--z-modal) は閉じたあとに飛ぶ。tutorial / celebration より下に置く */
		z-index: var(--z-reward);
	}
	.pf-fly {
		position: absolute;
		will-change: transform, opacity;
	}
	.pf-label {
		display: inline-block;
		transform: translate(-50%, -50%);
		white-space: nowrap;
		font-weight: bold;
		font-size: 1.5rem;
		line-height: 1;
		padding: 4px 10px;
		border-radius: var(--radius-full);
		background-color: var(--color-surface-card);
		box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
		/* 色だけに意味を載せない — 文字列側に + / - の符号が必ず入っている */
		color: var(--color-action-success);
		border: 2px solid var(--color-border-success-strong);
	}
	.pf-label.pf-spend {
		color: var(--color-action-danger);
		border-color: var(--color-border-danger);
	}
</style>
