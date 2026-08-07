<!--
  SiblingCelebration.svelte
  - #2107: Ark UI Dialog primitive (`$lib/ui/primitives/Dialog.svelte`) ベースに refactor。
    backdrop click / ESC / focus trap / aria-modal は primitive 側に委譲。
  - #2106: z-index は DESIGN §10 `--z-celebration` 階層を `zLayer="celebration"` で適用 (旧生数値 200)。
  - 紙吹雪エフェクトのみ component で保持 (Anti-engagement ADR-0012 整合: 1 件のみ、自動再生なし)。
  - #3333: ごほうび受取 form を撤去し「祝福演出のみ」に責務分離。claim は home の永続 claim-card
    (challenge-reward-claim-card) 単一経路に集約し、二重導線 / 二重 POST を排除する。dismiss しても
    完了済・未受取なら card で常時受取できるため dead-end にならない。
  - #4410: 「閉じる」を **表示条件を変える操作** にする。閉じたら `?/markChallengeCelebrationShown`
    (markCheersShown と同型の form action + use:enhance) で celebration_shown_at を永続化し、
    ページ遷移 / リロード / invalidateAll / 別端末のいずれでも再表示されないようにする
    (ADR-0012 anti-engagement / docs/DESIGN.md §10 連続演出禁止)。あわせて閉じたあとの受取場所を
    案内する (AC4、claim ボタンは戻さない = #3333 の二重導線排除を維持)。
-->
<script lang="ts">
import { enhance } from '$app/forms';
import { FEATURES_LABELS } from '$lib/domain/labels';
import Dialog from '$lib/ui/primitives/Dialog.svelte';

interface Props {
	/** #4410: 「見せた」記録の対象 instance id (form action へ渡す) */
	challengeId: string;
	challengeTitle: string;
	siblings: { name: string; completed: boolean }[];
	/** #4410: ごほうび未受取なら受取場所の案内 (AC4) を出す */
	showClaimHint?: boolean;
	onDismiss: () => void;
}

let { challengeId, challengeTitle, siblings, showClaimHint = false, onDismiss }: Props = $props();

// Confetti particles
// Confetti hex colors: kept as hex because JS array init runs before DOM is available for getComputedStyle
const confettiColors = ['#8b5cf6', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#ec4899'];
const confetti = Array.from({ length: 30 }, (_, i) => ({
	id: i,
	color: confettiColors[i % confettiColors.length],
	left: `${Math.random() * 100}%`,
	delay: `${Math.random() * 2}s`,
	duration: `${2 + Math.random() * 2}s`,
}));

let dialogOpen = $state(true);

// #4410: 「閉じた」は必ず永続化を伴う。closable={false} + closeOnEscape={false} で
// 閉じる経路を submit ボタン 1 本に絞り、「閉じたのに記録されない」経路を作らない
// (DESIGN.md §5 Dialog の closable / closeOnEscape 契約)。
function handleDialogChange(details: { open: boolean }) {
	dialogOpen = details.open;
}
</script>

<Dialog
	bind:open={dialogOpen}
	onOpenChange={handleDialogChange}
	zLayer="celebration"
	size="sm"
	closable={false}
	closeOnEscape={false}
	testid="sibling-celebration"
	ariaLabel={FEATURES_LABELS.challenge.celebrationTitle}
	contentClass="celebration__content"
>
	<!-- Confetti (Dialog の backdrop は Ark UI 提供のため、ここでは card 内の演出のみ) -->
	<div class="celebration__confetti" aria-hidden="true">
		{#each confetti as c (c.id)}
			<div
				class="celebration__particle"
				style:left={c.left}
				style:background={c.color}
				style:animation-delay={c.delay}
				style:animation-duration={c.duration}
			></div>
		{/each}
	</div>

	<div class="celebration__inner">
		<div class="celebration__emoji">🎉</div>
		<h2 class="celebration__title">{FEATURES_LABELS.challenge.celebrationTitle}</h2>
		<p class="celebration__challenge">{challengeTitle}</p>

		<div class="celebration__siblings">
			{#each siblings as sib (sib.name)}
				<div class="celebration__sibling">
					<span class="celebration__check">{sib.completed ? '✅' : '⬜'}</span>
					<span>{sib.name}</span>
				</div>
			{/each}
		</div>

		<!-- #4410 AC4: 閉じたあとの受取場所を案内する (claim ボタンは戻さない = #3333 維持)。 -->
		{#if showClaimHint}
			<p class="celebration__claim-hint" data-testid="sibling-celebration-claim-hint">
				{FEATURES_LABELS.challenge.celebrationClaimHint}
			</p>
		{/if}

		<!-- #4410: 閉じる = 「見せた」の永続化。markCheersShown と同型の form action。
		     閉じる操作は **サーバ応答を待たずに即座に閉じる**: ここは子供画面であり、祝福を閉じるのに
		     ネットワーク往復ぶん待たせるのは滞在時間を伸ばす方向 (ADR-0012)。記録はそのまま裏で走る。
		     記録に失敗した場合は次回もう一度出る (安全側 = 無音で消えるより再掲)。無音にはせず warn を残す。 -->
		<form
			method="POST"
			action="?/markChallengeCelebrationShown"
			use:enhance={() => {
				dialogOpen = false;
				onDismiss();
				return async ({ result }) => {
					if (result.type !== 'success') {
						console.warn(
							'[child-home] 祝福の表示済み記録に失敗しました (次回もう一度表示されます)',
							result,
						);
					}
					// update() は呼ばない: 既に閉じており、この画面に必要な再 load が無いため。
				};
			}}
		>
			<input type="hidden" name="challengeId" value={challengeId} />
			<button type="submit" class="celebration__close-btn" data-testid="sibling-celebration-close">
				{FEATURES_LABELS.challenge.celebrationCloseBtn}
			</button>
		</form>
	</div>
</Dialog>

<style>
	/* Dialog content card inner customization */
	:global(.celebration__content) {
		position: relative;
		text-align: center;
		overflow: hidden;
	}

	.celebration__confetti {
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.celebration__particle {
		position: absolute;
		top: -10px;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		animation: confetti-fall linear forwards;
	}

	.celebration__inner {
		position: relative;
		z-index: 1;
	}

	.celebration__emoji {
		font-size: 3rem;
		margin-bottom: 8px;
	}

	.celebration__title {
		font-size: 1.5rem;
		font-weight: 800;
		background: linear-gradient(135deg, var(--color-violet-500), var(--color-warning));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		margin-bottom: 4px;
	}

	.celebration__challenge {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		margin-bottom: 16px;
	}

	.celebration__siblings {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-bottom: 20px;
	}

	.celebration__sibling {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		background: var(--color-premium-bg);
		border-radius: 20px;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-violet-600);
	}

	.celebration__check {
		font-size: 0.875rem;
	}

	.celebration__claim-hint {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin-bottom: 12px;
	}

	.celebration__close-btn {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
		background: var(--color-surface-card);
		color: var(--color-text-muted);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
	}

	@keyframes confetti-fall {
		0% {
			transform: translateY(-10px) rotate(0deg);
			opacity: 1;
		}
		100% {
			transform: translateY(100vh) rotate(720deg);
			opacity: 0;
		}
	}
</style>
