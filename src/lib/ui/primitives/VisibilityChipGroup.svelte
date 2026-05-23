<script lang="ts">
import { VISIBILITY_CHIP_LABELS } from '$lib/domain/labels';

/**
 * VisibilityChipGroup primitive (EPIC #2362 PR-2)
 *
 * family master 採用 type (checklist / rule bonus) の edit modal 内で、
 * per-child visibility (どの子に配信するか) を chip toggle で表示する UI。
 *
 * 各 chip click で visibility ON/OFF を切替、callback で呼び出し側に通知。
 * state 永続化 (DB update / form submit) は呼び出し側責務 (Pure presentation、SRP、DIP)。
 *
 * UX 規約 (User 合意済 2026-05-23 §6.3):
 *   - chip click で toggle (ON = 表示 / OFF = 非表示)
 *   - 「全員 ON」「全員 OFF」ショートカット button
 *   - state 永続化は呼び出し側責務
 *
 * DESIGN.md §5 primitive、§10 z-index (`--z-base` = 0、通常 flow) 整合。
 *
 * 用途上の注意:
 * - family master type (checklist / rule bonus) 専用
 * - per-child type (activity / reward / challenge) では ChildSelectionDialog を使う
 * - 子供数増加時 (10 人) は flex-wrap で折り返し対応
 */

export interface VisibilityChild {
	/** child の ID (DB primary key 推奨) */
	id: number;
	/** 表示名 (nickname) */
	nickname: string;
	/** 年齢 (label 表示用、任意) */
	age?: number;
	/** 任意のアイコン (絵文字 1 文字推奨) */
	icon?: string;
}

interface Props {
	/** 配信先候補の child 配列 */
	children: VisibilityChild[];
	/** 各 child ごとの visibility (true = 表示 / false = 非表示)。未定義キーは ON 扱い */
	visibility: Record<number, boolean>;
	/** chip toggle ハンドラ */
	onToggle: (childId: number, visible: boolean) => void;
	/** 「全員 ON」「全員 OFF」ショートカット表示 (default: true) */
	showShortcuts?: boolean;
	/** 任意の testid (group wrapper に付与) */
	testid?: string;
}

let {
	children,
	visibility,
	onToggle,
	showShortcuts = true,
	testid = 'visibility-chip-group',
}: Props = $props();

function isVisible(childId: number): boolean {
	// 未定義キーは ON 扱い (新規 child 追加時の default 表示)
	return visibility[childId] !== false;
}

function handleChipClick(childId: number) {
	onToggle(childId, !isVisible(childId));
}

function handleAllOn() {
	for (const child of children) {
		if (!isVisible(child.id)) {
			onToggle(child.id, true);
		}
	}
}

function handleAllOff() {
	for (const child of children) {
		if (isVisible(child.id)) {
			onToggle(child.id, false);
		}
	}
}

const allOn = $derived(children.every((c) => isVisible(c.id)));
const allOff = $derived(children.every((c) => !isVisible(c.id)));
</script>

<section
	class="visibility-chip-group"
	role="group"
	aria-label={VISIBILITY_CHIP_LABELS.groupAriaLabel}
	data-testid={testid}
>
	<header class="visibility-chip-group__header">
		<h3 class="visibility-chip-group__title">{VISIBILITY_CHIP_LABELS.sectionTitle}</h3>
		{#if showShortcuts && children.length > 1}
			<div class="visibility-chip-group__shortcuts">
				<button
					type="button"
					class="visibility-chip-shortcut"
					onclick={handleAllOn}
					disabled={allOn}
					data-testid="visibility-shortcut-all-on"
				>
					{VISIBILITY_CHIP_LABELS.allOn}
				</button>
				<button
					type="button"
					class="visibility-chip-shortcut"
					onclick={handleAllOff}
					disabled={allOff}
					data-testid="visibility-shortcut-all-off"
				>
					{VISIBILITY_CHIP_LABELS.allOff}
				</button>
			</div>
		{/if}
	</header>
	<div class="visibility-chip-group__chips">
		{#each children as child (child.id)}
			{@const visible = isVisible(child.id)}
			<button
				type="button"
				class="visibility-chip"
				class:visibility-chip--off={!visible}
				onclick={() => handleChipClick(child.id)}
				aria-pressed={visible}
				aria-label="{child.nickname}: {visible
					? VISIBILITY_CHIP_LABELS.toggleOn
					: VISIBILITY_CHIP_LABELS.toggleOff}"
				data-testid="visibility-chip-{child.id}"
			>
				{#if child.icon}
					<span class="visibility-chip__icon" aria-hidden="true">{child.icon}</span>
				{/if}
				<span class="visibility-chip__label">
					{child.nickname}{#if child.age !== undefined}
						<span class="visibility-chip__age"> ({child.age})</span>
					{/if}
				</span>
				<span class="visibility-chip__state" aria-hidden="true">
					{visible ? '●' : '○'}
				</span>
			</button>
		{/each}
	</div>
</section>

<style>
	.visibility-chip-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.visibility-chip-group__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.visibility-chip-group__title {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0;
	}

	.visibility-chip-group__shortcuts {
		display: flex;
		gap: 0.25rem;
	}

	.visibility-chip-shortcut {
		padding: 0.25rem 0.6rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		background: transparent;
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background 0.1s;
	}

	.visibility-chip-shortcut:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.visibility-chip-shortcut:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.visibility-chip-group__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.visibility-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.75rem;
		min-height: 44px;
		font-size: 0.875rem;
		color: var(--color-text-primary);
		background: var(--color-surface-accent);
		border: 2px solid var(--color-border-focus);
		border-radius: var(--radius-full);
		cursor: pointer;
		transition: background 0.1s, border-color 0.1s, opacity 0.1s;
	}

	.visibility-chip:hover {
		filter: brightness(0.97);
	}

	.visibility-chip--off {
		background: var(--color-surface-muted);
		border-color: var(--color-border-default);
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.visibility-chip__icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.visibility-chip__label {
		flex: 1;
	}

	.visibility-chip__age {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	.visibility-chip__state {
		font-size: 0.85rem;
		line-height: 1;
	}
</style>
