<script lang="ts">
/** 初回記録完了後のワンタイム通知バナー: ❓ガイドの存在を知らせる */

interface Props {
	/** 初回記録完了済みかどうか */
	visible: boolean;
	onDismiss: () => void;
}

let { visible, onDismiss }: Props = $props();
</script>

{#if visible}
	<div class="tutorial-hint" data-testid="tutorial-hint-banner">
		<span class="text-xl">💡</span>
		<div class="flex-1">
			<p class="font-bold text-sm">つかいかた ガイド あるよ！</p>
			<p class="text-xs opacity-80">いつでも ❓ ボタンで みれるよ</p>
		</div>
		<button
			type="button"
			class="dismiss-btn"
			onclick={onDismiss}
			aria-label="閉じる"
		>✕</button>
	</div>
{/if}

<style>
	.tutorial-hint {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		margin-top: 8px;
		background: rgba(59, 130, 246, 0.1);
		border: 1px solid rgba(59, 130, 246, 0.2);
		border-radius: var(--radius-md, 12px);
		animation: hint-appear 0.3s ease-out;
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: var(--color-text-muted, #6b7280);
		cursor: pointer;
		font-size: 1rem;
		padding: 4px;
		line-height: 1;
	}

	@keyframes hint-appear {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
