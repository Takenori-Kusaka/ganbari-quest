<script lang="ts">
import { enhance } from '$app/forms';
import { joinIcon, splitIcon } from '$lib/domain/icon-utils';
import type { CategoryDef } from '$lib/domain/validation/activity';
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';
import { type ActivityItem, DAILY_LIMIT_OPTIONS, SUB_ICON_PRESETS } from './activity-types';

interface Props {
	activity: ActivityItem;
	categoryDefs: readonly CategoryDef[];
	logCount: number;
	onsaved: () => void;
	oncancel: () => void;
}

let { activity, categoryDefs, logCount, onsaved, oncancel }: Props = $props();

const parsed = splitIcon(activity.icon);
let editName = $state(activity.name);
let editCategoryId = $state(activity.categoryId);
let editMainIcon = $state(parsed.main);
let editSubIcon = $state(parsed.sub ?? '');
const editIcon = $derived(joinIcon(editMainIcon, editSubIcon || null));
let editPoints = $state(activity.basePoints);
let editAgeMin = $state(activity.ageMin != null ? String(activity.ageMin) : '');
let editAgeMax = $state(activity.ageMax != null ? String(activity.ageMax) : '');
let editDailyLimit = $state<string>(activity.dailyLimit != null ? String(activity.dailyLimit) : '');
let editNameKana = $state(activity.nameKana ?? '');
let editNameKanji = $state(activity.nameKanji ?? '');
let editTriggerHint = $state(activity.triggerHint ?? '');
let deleteConfirmId = $state<number | null>(null);
let actionMessage = $state('');
</script>

<div class="border-t px-3 py-3 space-y-3 bg-[var(--color-surface-muted)] rounded-b-lg">
	<form
		method="POST"
		action="?/edit"
		use:enhance={() => {
			return async ({ result, update }) => {
				if (result.type === 'success') {
					onsaved();
				}
				await update();
			};
		}}
		class="space-y-3"
	>
		<input type="hidden" name="id" value={activity.id} />
		<div class="grid grid-cols-[1fr,auto] gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">名前</span>
				<input type="text" name="name" bind:value={editName} required class="w-full px-2 py-1.5 border rounded text-sm" />
			</label>
			<div>
				<span class="text-xs font-bold text-[var(--color-text-muted)]">アイコン</span>
				<div class="flex gap-1 items-center mt-0.5">
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center"
						value={editMainIcon}
						oninput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) editMainIcon = v; }}
					/>
					<span class="text-xs text-[var(--color-text-muted)]">+</span>
					<input type="text" class="w-10 px-1 py-1.5 border rounded text-sm text-center" placeholder="サブ"
						value={editSubIcon}
						oninput={(e) => { editSubIcon = (e.target as HTMLInputElement).value; }}
					/>
					<CompoundIcon icon={editIcon} size="md" />
				</div>
				<div class="flex flex-wrap gap-0.5 mt-1">
					<button type="button" class="w-7 h-7 rounded text-xs flex items-center justify-center {editSubIcon === '' ? 'bg-[var(--color-feedback-info-bg-strong)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-muted-strong)]'}" onclick={() => editSubIcon = ''}>なし</button>
					{#each SUB_ICON_PRESETS.slice(0, 8) as ic}
						<button type="button" class="w-7 h-7 rounded text-sm flex items-center justify-center {editSubIcon === ic ? 'bg-[var(--color-feedback-info-bg-strong)]' : 'bg-[var(--color-surface-muted)] hover:bg-[var(--color-surface-muted-strong)]'}" onclick={() => editSubIcon = ic}>{ic}</button>
					{/each}
				</div>
				<input type="hidden" name="icon" value={editIcon} />
			</div>
		</div>
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">カテゴリ</span>
				<select name="categoryId" bind:value={editCategoryId} class="w-full px-2 py-1.5 border rounded text-sm">
					{#each categoryDefs as catDef}
						<option value={catDef.id}>{catDef.name}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">ポイント</span>
				<input type="number" name="basePoints" bind:value={editPoints} min="1" max="100" class="w-full px-2 py-1.5 border rounded text-sm" />
			</label>
		</div>
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">対象年齢（下限）</span>
				<input type="number" name="ageMin" bind:value={editAgeMin} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="なし" />
			</label>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">対象年齢（上限）</span>
				<input type="number" name="ageMax" bind:value={editAgeMax} min="0" max="18" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="なし" />
			</label>
		</div>
		<!-- dailyLimit -->
		<div>
			<span class="text-xs font-bold text-[var(--color-text-muted)]">1日の回数制限</span>
			<div class="flex gap-1 mt-1">
				{#each DAILY_LIMIT_OPTIONS as opt}
					<button
						type="button"
						class="flex-1 py-1 rounded text-xs font-bold transition-colors
							{editDailyLimit === opt.val ? 'bg-[var(--color-brand-500)] text-white' : 'bg-[var(--color-surface-muted-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-neutral-200)]'}"
						onclick={() => editDailyLimit = opt.val}
					>
						{opt.label}
					</button>
				{/each}
			</div>
			<input type="hidden" name="dailyLimit" value={editDailyLimit} />
		</div>

		<!-- ひらがな・漢字表記 -->
		<div class="grid grid-cols-2 gap-2">
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">ひらがな表記</span>
				<input type="text" name="nameKana" bind:value={editNameKana} class="w-full px-2 py-1.5 border rounded text-sm" placeholder="省略可" />
			</label>
			<label class="block">
				<span class="text-xs font-bold text-[var(--color-text-muted)]">漢字表記</span>
				<input type="text" name="nameKanji" bind:value={editNameKanji} class="w-full px-2 py-1.5 border rounded text-sm" placeholder="省略可" />
			</label>
		</div>
		<!-- トリガーヒント -->
		<label class="block">
			<span class="text-xs font-bold text-[var(--color-text-muted)]">子供へのヒント（いつ押すか）</span>
			<input type="text" name="triggerHint" bind:value={editTriggerHint} maxlength="30" class="w-full px-2 py-1.5 border rounded text-sm" placeholder="はみがきが終わったら押してね" />
			<span class="text-[10px] text-[var(--color-text-muted)]">カードの下に小さく表示されます（30文字まで）</span>
		</label>
		<div class="flex gap-2">
			<button type="submit" class="flex-1 py-2 bg-[var(--color-brand-500)] text-white rounded-lg font-bold text-sm hover:bg-[var(--color-brand-600)] transition-colors">
				保存
			</button>
			<button
				type="button"
				class="px-4 py-2 bg-[var(--color-feedback-error-bg-strong)] text-[var(--color-feedback-error-text)] rounded-lg font-bold text-sm hover:brightness-95 transition-all"				onclick={() => deleteConfirmId = deleteConfirmId === activity.id ? null : activity.id}			>
				削除
			</button>
		</div>
	</form>

	<!-- Delete confirmation -->
	{#if deleteConfirmId === activity.id}
		<div class="bg-[var(--color-feedback-error-bg)] border border-[var(--color-feedback-error-border)] rounded-lg p-3 space-y-2">
			{#if logCount > 0}
				<p class="text-sm text-[var(--color-feedback-warning-text)] font-bold">この活動には {logCount} 件の記録があります</p>
				<p class="text-xs text-[var(--color-feedback-warning-text)]">記録を保護するため、完全削除ではなく「非表示」にします。非表示の活動は子供の画面に表示されなくなりますが、過去の記録はそのまま残ります。</p>
			{:else}
				<p class="text-sm text-[var(--color-feedback-error-text)] font-bold">本当に削除しますか？</p>
				<p class="text-xs text-[var(--color-feedback-error-text)]">この活動は完全に削除されます。この操作は取り消せません。</p>
			{/if}
			<div class="flex gap-2">
				<form
					method="POST"
					action="?/delete"
					class="flex-1"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'success') {
								onsaved();
								deleteConfirmId = null;
								if (result.data && 'hidden' in result.data) {
									actionMessage = '記録があるため非表示にしました';
									setTimeout(() => { actionMessage = ''; }, 5000);
								}
							}
							await update();
						};
					}}
				>
					<input type="hidden" name="id" value={activity.id} />
					<button type="submit" class="w-full py-2 {logCount > 0 ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-action-danger)]'} text-white rounded-lg font-bold text-sm hover:brightness-90 transition-all">						{logCount > 0 ? '非表示にする' : '削除する'}					</button>
				</form>
				<button
					type="button"
					class="flex-1 py-2 bg-[var(--color-neutral-200)] rounded-lg font-bold text-sm hover:bg-[var(--color-neutral-300)] transition-colors"
					onclick={() => deleteConfirmId = null}
				>
					キャンセル
				</button>
			</div>
		</div>
	{/if}
</div>
