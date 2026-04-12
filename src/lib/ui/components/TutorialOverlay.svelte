<script lang="ts">
import {
	continueFullTutorial,
	dismissResumePrompt,
	endTutorial,
	finishQuickTutorial,
	getCurrentStep,
	isQuickCompleteShown,
	isResumePromptShown,
	isTutorialActive,
	resumeTutorial,
	startFromBeginning,
} from '$lib/ui/tutorial/tutorial-store.svelte';
import TutorialBubble from './TutorialBubble.svelte';

let targetRect = $state<DOMRect | null>(null);
let animKey = $state(0);
let showExitConfirm = $state(false);

const active = $derived(isTutorialActive());
const step = $derived(getCurrentStep());
const showResume = $derived(isResumePromptShown());
const showQuickComplete = $derived(isQuickCompleteShown());

// A. チュートリアル中はナビのz-indexを抑制するためhtml要素にフラグを付与
$effect(() => {
	if (active) {
		document.documentElement.setAttribute('data-tutorial-active', '');
		return () => document.documentElement.removeAttribute('data-tutorial-active');
	}
	document.documentElement.removeAttribute('data-tutorial-active');
});

/** Find the first visible element matching a selector (handles responsive layouts) */
function findVisibleElement(selector: string): Element | null {
	const candidates = document.querySelectorAll(selector);
	for (const el of candidates) {
		const rect = el.getBoundingClientRect();
		if (rect.width > 0 && rect.height > 0) return el;
	}
	return candidates[0] ?? null;
}

/**
 * B. MutationObserver で対象要素の出現を待機し、位置安定後にフォーカスを設定する。
 * タイムアウト付き（最大3秒）で、要素が見つからなければ中央表示にフォールバック。
 */
function waitForElement(
	selector: string,
	callback: (el: Element) => void,
	signal: AbortSignal,
	timeoutMs = 3000,
) {
	// 即座に見つかる場合
	const existing = findVisibleElement(selector);
	if (existing) {
		requestAnimationFrame(() => {
			if (!signal.aborted) callback(existing);
		});
		return;
	}

	let timer: ReturnType<typeof setTimeout>;

	const observer = new MutationObserver(() => {
		const el = findVisibleElement(selector);
		if (el) {
			observer.disconnect();
			clearTimeout(timer);
			requestAnimationFrame(() => {
				if (!signal.aborted) callback(el);
			});
		}
	});

	observer.observe(document.body, { childList: true, subtree: true, attributes: true });

	timer = setTimeout(() => {
		observer.disconnect();
		if (!signal.aborted) {
			// 最終チェック
			const el = findVisibleElement(selector);
			if (el) {
				callback(el);
			} else {
				// 要素未発見 — 中央表示フォールバック
				showCenteredBubble();
			}
		}
	}, timeoutMs);

	signal.addEventListener('abort', () => {
		observer.disconnect();
		clearTimeout(timer);
	});
}

function showCenteredBubble() {
	targetRect = new DOMRect(window.innerWidth / 2 - 100, window.innerHeight / 3, 200, 40);
	animKey++;
}

function focusElement(el: Element) {
	el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	// スクロール完了を待って位置を取得
	requestAnimationFrame(() => {
		setTimeout(() => {
			targetRect = el.getBoundingClientRect();
			animKey++;
		}, 300);
	});
}

$effect(() => {
	if (active && step) {
		const controller = new AbortController();

		if (step.selector) {
			// セレクタ指定あり — MutationObserverで要素出現を待機
			waitForElement(step.selector, focusElement, controller.signal);
		} else {
			// セレクタなし — 中央表示
			requestAnimationFrame(() => {
				if (!controller.signal.aborted) showCenteredBubble();
			});
		}

		return () => controller.abort();
	}
	targetRect = null;
});

// リサイズ・スクロール時にtargetRectを再計算（バブル位置を動的に追従）
$effect(() => {
	if (!active || !step?.selector) return;

	function recalc() {
		const el = step?.selector ? findVisibleElement(step.selector) : null;
		if (el) {
			targetRect = el.getBoundingClientRect();
		}
	}

	window.addEventListener('resize', recalc, { passive: true });
	window.addEventListener('scroll', recalc, { passive: true, capture: true });

	return () => {
		window.removeEventListener('resize', recalc);
		window.removeEventListener('scroll', recalc, { capture: true });
	};
});

function handleOverlayClick(e: MouseEvent) {
	// Show exit confirmation instead of closing immediately
	if ((e.target as HTMLElement).classList.contains('tutorial-overlay-bg')) {
		showExitConfirm = true;
	}
}

function confirmExit() {
	showExitConfirm = false;
	endTutorial();
}

function cancelExit() {
	showExitConfirm = false;
}
</script>

<!-- Resume prompt dialog -->
{#if showResume}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-overlay">
		<div class="tutorial-overlay-backdrop"></div>
		<div class="tutorial-dialog" role="dialog" aria-label="チュートリアル再開" tabindex="-1">
			<div class="tutorial-dialog-header">
				<span aria-hidden="true">📖</span>
				<span>チュートリアルの続き</span>
			</div>
			<div class="tutorial-dialog-body">
				<p>前回の途中から続けますか？</p>
			</div>
			<div class="tutorial-dialog-actions">
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--secondary"
					onclick={dismissResumePrompt}
				>
					キャンセル
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--secondary"
					onclick={() => startFromBeginning()}
				>
					最初から
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--primary"
					onclick={() => resumeTutorial()}
				>
					続きから
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- #955: Quick complete dialog — チャプター1終了後の選択画面 -->
{#if showQuickComplete}
	<div class="tutorial-overlay">
		<div class="tutorial-overlay-backdrop"></div>
		<div class="tutorial-dialog" role="dialog" aria-label="チュートリアル完了" tabindex="-1">
			<div class="tutorial-dialog-header">
				<span aria-hidden="true">🎉</span>
				<span>基本の使い方を確認しました！</span>
			</div>
			<div class="tutorial-dialog-body">
				<p>ここからは実際にお子さまを登録して使い始めましょう。</p>
				<p class="tutorial-dialog-hint">残りのガイド（活動管理・報酬・レポートなど）は、いつでもヘッダーの「❓」ボタンから確認できます。</p>
			</div>
			<div class="tutorial-dialog-actions">
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--secondary"
					onclick={() => continueFullTutorial()}
				>
					もっと詳しく見る
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--primary"
					onclick={() => finishQuickTutorial()}
				>
					使い始める
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Exit confirmation dialog -->
{#if showExitConfirm && active}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-confirm-overlay" onclick={cancelExit}>
		<div
			class="tutorial-dialog"
			role="dialog"
			aria-label="チュートリアル終了確認"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="tutorial-dialog-body">
				<p>チュートリアルを終了しますか？</p>
				<p class="tutorial-dialog-hint">進捗は保存されるので、後から続きを再開できます。</p>
			</div>
			<div class="tutorial-dialog-actions">
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--secondary"
					onclick={cancelExit}
				>
					続ける
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--danger"
					onclick={confirmExit}
				>
					終了する
				</button>
			</div>
		</div>
	</div>
{/if}

{#if active && step && targetRect}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-overlay" onclick={handleOverlayClick}>
		<!-- Dark overlay with spotlight cutout -->
		<svg class="tutorial-overlay-svg" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<mask id="tutorial-spotlight">
					<rect width="100%" height="100%" fill="white" />
					<rect
						x={targetRect.x - 8}
						y={targetRect.y - 8}
						width={targetRect.width + 16}
						height={targetRect.height + 16}
						rx="12"
						fill="black"
					/>
				</mask>
			</defs>
			<rect
				class="tutorial-overlay-bg"
				width="100%"
				height="100%"
				fill="rgba(0,0,0,0.6)"
				mask="url(#tutorial-spotlight)"
			/>
		</svg>

		<!-- Spotlight border glow -->
		<div
			class="tutorial-spotlight-ring"
			style:top="{targetRect.y - 10}px"
			style:left="{targetRect.x - 10}px"
			style:width="{targetRect.width + 20}px"
			style:height="{targetRect.height + 20}px"
		></div>

		<!-- Bubble -->
		{#key animKey}
			<TutorialBubble {step} {targetRect} />
		{/key}
	</div>
{/if}

<style>
	.tutorial-overlay {
		position: fixed;
		inset: 0;
		z-index: 100;
	}

	.tutorial-overlay-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
	}

	.tutorial-overlay-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.tutorial-overlay-bg {
		pointer-events: auto;
		cursor: default;
	}

	.tutorial-spotlight-ring {
		position: absolute;
		border: 2px solid rgba(59, 130, 246, 0.6);
		border-radius: 12px;
		box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
		pointer-events: none;
		animation: ring-pulse 2s ease-in-out infinite;
	}

	@keyframes ring-pulse {
		0%, 100% {
			box-shadow: 0 0 12px rgba(59, 130, 246, 0.3);
		}
		50% {
			box-shadow: 0 0 24px rgba(59, 130, 246, 0.5);
		}
	}

	/* Confirm overlay — sits above the tutorial overlay */
	.tutorial-confirm-overlay {
		position: fixed;
		inset: 0;
		z-index: 120;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Dialog shared styles */
	.tutorial-dialog {
		position: relative;
		z-index: 110;
		background: white;
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
		width: 320px;
		max-width: 90vw;
		margin: auto;
		overflow: hidden;
		animation: dialog-appear 0.2s ease-out;
		/* Center in overlay */
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
	}

	.tutorial-confirm-overlay .tutorial-dialog {
		position: relative;
		top: auto;
		left: auto;
		transform: none;
	}

	@keyframes dialog-appear {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}

	.tutorial-confirm-overlay .tutorial-dialog {
		animation-name: dialog-appear-centered;
	}

	@keyframes dialog-appear-centered {
		from {
			opacity: 0;
			transform: scale(0.95);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	.tutorial-dialog-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 16px;
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		color: white;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.tutorial-dialog-body {
		padding: 20px 16px 12px;
	}

	.tutorial-dialog-body p {
		margin: 0;
		font-size: 0.9rem;
		color: #334155;
		line-height: 1.5;
	}

	.tutorial-dialog-hint {
		margin-top: 8px !important;
		font-size: 0.8rem !important;
		color: #64748b !important;
	}

	.tutorial-dialog-actions {
		display: flex;
		gap: 8px;
		padding: 12px 16px 16px;
		justify-content: flex-end;
	}

	.tutorial-dialog-btn {
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		border: none;
		cursor: pointer;
		transition: all 0.15s;
	}

	.tutorial-dialog-btn--primary {
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		color: white;
	}

	.tutorial-dialog-btn--primary:hover {
		background: linear-gradient(135deg, #2563eb, #1d4ed8);
	}

	.tutorial-dialog-btn--secondary {
		background: #f1f5f9;
		color: #475569;
	}

	.tutorial-dialog-btn--secondary:hover {
		background: #e2e8f0;
	}

	.tutorial-dialog-btn--danger {
		background: #fef2f2;
		color: #dc2626;
	}

	.tutorial-dialog-btn--danger:hover {
		background: #fee2e2;
	}

	/* A. チュートリアル中はナビ・ヘッダーのz-indexをオーバーレイ以下に抑制 */
	:global([data-tutorial-active]) :global(.z-30) {
		z-index: 10 !important;
	}
	:global([data-tutorial-active]) :global(.desktop-dropdown) {
		z-index: 10 !important;
	}
</style>
