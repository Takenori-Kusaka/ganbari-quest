<script lang="ts">
import { TUTORIAL_LABELS } from '$lib/domain/labels';
import {
	continueFullTutorial,
	dismissResumePrompt,
	finishQuickTutorial,
	resumeTutorial,
	startFromBeginning,
} from '$lib/ui/tutorial/tutorial-store.svelte';

interface Props {
	showResume: boolean;
	showQuickComplete: boolean;
	showExitConfirm: boolean;
	onConfirmExit: () => void;
	onCancelExit: () => void;
}

let { showResume, showQuickComplete, showExitConfirm, onConfirmExit, onCancelExit }: Props =
	$props();
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
					{TUTORIAL_LABELS.quickContinue}
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--primary"
					onclick={() => finishQuickTutorial()}
				>
					{TUTORIAL_LABELS.quickFinish}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Exit confirmation dialog -->
{#if showExitConfirm}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tutorial-confirm-overlay" onclick={onCancelExit}>
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
					onclick={onCancelExit}
				>
					続ける
				</button>
				<button
					type="button"
					class="tutorial-dialog-btn tutorial-dialog-btn--danger"
					onclick={onConfirmExit}
				>
					終了する
				</button>
			</div>
		</div>
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
		position: fixed;
		z-index: 110;
		background: white;
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
		width: 320px;
		max-width: 90vw;
		overflow: hidden;
		animation: dialog-appear 0.2s ease-out;
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
</style>
