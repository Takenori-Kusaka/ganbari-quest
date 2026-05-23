<script lang="ts">
import { CHILD_SELECTION_LABELS } from '$lib/domain/labels';
import Button from './Button.svelte';
import Dialog from './Dialog.svelte';

/**
 * ChildSelectionDialog primitive (EPIC #2362 PR-2)
 *
 * per-child 採用 type (activity / reward / challenge) の marketplace 取込時に
 * 「誰に追加するか / 全員に追加するか」を選択させる Dialog。
 *
 * Dialog primitive を内包 (Composition over Inheritance) し、UX 規約に従って
 * 「全員に追加」を primary option として配置。state 永続化 / 取込 API 呼出は
 * 呼び出し側 callback (Pure presentation、SRP)。
 *
 * UX 規約 (User 合意済 2026-05-23 §6.2):
 *   - title: 「どのお子さまに追加?」
 *   - option 1: 「全員に追加」 (primary button)
 *   - option 2-N: 各 child の名前 + アイコン
 *   - footer: 「追加」/「キャンセル」
 *
 * DESIGN.md §5 primitive、§10 z-index (Dialog 内包で backdrop=--z-overlay / content=--z-modal) 整合。
 *
 * 用途上の注意:
 * - per-child 採用 type (activity / reward / challenge) で必須
 * - family master type (checklist / rule bonus) では「全員 default」で skip 可能
 *   (呼び出し側で open=false を維持して dialog を表示しない選択肢あり)
 */

export interface ChildOption {
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
	/** 取込先候補の child 配列 */
	children: ChildOption[];
	/** dialog open state (bindable) */
	open: boolean;
	/** 複数選択許可 (default = false、radio 単一選択。true で checkbox 複数選択) */
	allowMultiple?: boolean;
	/** 確定ハンドラ: 'all' (全員) or 選択された child ID 配列 */
	onConfirm: (result: 'all' | number[]) => void;
	/** キャンセルハンドラ */
	onCancel?: () => void;
	/** 任意の testid (Dialog content に付与) */
	testid?: string;
}

let {
	children,
	open = $bindable(),
	allowMultiple = false,
	onConfirm,
	onCancel,
	testid = 'child-selection-dialog',
}: Props = $props();

type Selection = 'all' | { type: 'individual'; ids: number[] };

let selection = $state<Selection>('all');

function handleOpenChange(details: { open: boolean }) {
	open = details.open;
	if (!details.open) {
		onCancel?.();
		// reset selection for next open
		selection = 'all';
	}
}

function handleAllSelect() {
	selection = 'all';
}

function handleChildToggle(childId: number) {
	if (allowMultiple) {
		if (selection === 'all') {
			selection = { type: 'individual', ids: [childId] };
		} else {
			const ids = selection.ids.includes(childId)
				? selection.ids.filter((id) => id !== childId)
				: [...selection.ids, childId];
			selection = ids.length === 0 ? 'all' : { type: 'individual', ids };
		}
	} else {
		selection = { type: 'individual', ids: [childId] };
	}
}

function isChildSelected(childId: number): boolean {
	if (selection === 'all') return false;
	return selection.ids.includes(childId);
}

function handleConfirm() {
	if (selection === 'all') {
		onConfirm('all');
	} else {
		onConfirm(selection.ids);
	}
	open = false;
	selection = 'all';
}

function handleCancelClick() {
	onCancel?.();
	open = false;
	selection = 'all';
}

const isAllSelected = $derived(selection === 'all');
const canConfirm = $derived.by(() => {
	if (selection === 'all') return true;
	return selection.ids.length > 0;
});
const inputType = $derived(allowMultiple ? 'checkbox' : 'radio');
</script>

<Dialog
	bind:open
	onOpenChange={handleOpenChange}
	title={CHILD_SELECTION_LABELS.dialogTitle}
	{testid}
	size="md"
	ariaLabel={CHILD_SELECTION_LABELS.dialogTitle}
>
	<div class="child-selection-list" role="group" aria-label={CHILD_SELECTION_LABELS.listAriaLabel}>
		<label class="child-selection-option child-selection-option--all">
			<input
				type={inputType}
				name="child-selection"
				checked={isAllSelected}
				onchange={handleAllSelect}
				data-testid="child-selection-all"
			/>
			<span class="child-selection-option__icon" aria-hidden="true">👨‍👩‍👧‍👦</span>
			<span class="child-selection-option__label">
				{CHILD_SELECTION_LABELS.allOption}
			</span>
		</label>
		{#each children as child (child.id)}
			<label class="child-selection-option">
				<input
					type={inputType}
					name="child-selection"
					checked={isChildSelected(child.id)}
					onchange={() => handleChildToggle(child.id)}
					data-testid="child-selection-{child.id}"
				/>
				{#if child.icon}
					<span class="child-selection-option__icon" aria-hidden="true">{child.icon}</span>
				{/if}
				<span class="child-selection-option__label">
					{child.nickname}{#if child.age !== undefined}
						<span class="child-selection-option__age">
							{` (${child.age} ${CHILD_SELECTION_LABELS.ageUnitSuffix})`}
						</span>
					{/if}
				</span>
			</label>
		{/each}
	</div>
	<div class="child-selection-footer">
		<Button variant="ghost" onclick={handleCancelClick}>
			{CHILD_SELECTION_LABELS.cancel}
		</Button>
		<Button
			variant="primary"
			disabled={!canConfirm}
			onclick={handleConfirm}
			data-testid="child-selection-confirm"
		>
			{CHILD_SELECTION_LABELS.confirm}
		</Button>
	</div>
</Dialog>

<style>
	.child-selection-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: var(--sp-md);
	}

	.child-selection-option {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		border: 2px solid var(--color-border-default);
		border-radius: var(--radius-md);
		cursor: pointer;
		transition: border-color 0.1s, background 0.1s;
		min-height: 56px;
	}

	.child-selection-option:hover {
		background: var(--color-surface-muted);
	}

	.child-selection-option:has(input:checked) {
		border-color: var(--color-border-focus);
		background: var(--color-surface-accent);
	}

	.child-selection-option--all {
		font-weight: 600;
	}

	.child-selection-option__icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.child-selection-option__label {
		flex: 1;
		font-size: 0.95rem;
		color: var(--color-text-primary);
	}

	.child-selection-option__age {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.child-selection-option input {
		flex-shrink: 0;
	}

	.child-selection-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: var(--sp-sm);
		border-top: 1px solid var(--color-border-light);
	}
</style>
