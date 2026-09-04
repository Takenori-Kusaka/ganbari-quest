<script lang="ts">
import { untrack } from 'svelte';
import { daysInMonthOfKey, jstYearMonth } from '$lib/domain/date-utils';
import { UI_PRIMITIVES_LABELS } from '$lib/domain/labels';
import FormField from './FormField.svelte';
import NativeSelect from './NativeSelect.svelte';

interface Props {
	label?: string;
	value?: string | undefined; // ISO date YYYY-MM-DD or undefined
	name?: string;
	id?: string;
	required?: boolean;
	error?: string;
	hint?: string;
}

let {
	label = UI_PRIMITIVES_LABELS.birthdayInputLabel,
	value = $bindable(),
	name,
	id,
	required,
	error,
	hint,
}: Props = $props();

// 年の選択肢は JST SSOT 経由 (#4015)。ローカル getter だと SSR (UTC) と client で
// 年始 00:00〜09:00 に選択肢の範囲が 1 年ずれる。
const currentYear = jstYearMonth().year;
const years = Array.from({ length: 19 }, (_, i) => currentYear - i);
const yearOptions = years.map((y) => ({
	value: String(y),
	label: `${y}${UI_PRIMITIVES_LABELS.yearUnit}`,
}));

const monthOptions = Array.from({ length: 12 }, (_, i) => ({
	value: String(i + 1),
	label: `${i + 1}${UI_PRIMITIVES_LABELS.monthUnit}`,
}));

let yearStr = $state('');
let monthStr = $state('');
let dayStr = $state('');

// value（外部）→ year/month/day の同期。書き込みは untrack で循環を断ち切る
$effect(() => {
	const v = value;
	untrack(() => {
		if (v) {
			const [y, m, d] = v.split('-');
			yearStr = y ?? '';
			monthStr = m ? String(Number(m)) : '';
			dayStr = d ? String(Number(d)) : '';
		} else {
			yearStr = '';
			monthStr = '';
			dayStr = '';
		}
	});
});

// year/month/day → value（外部）の同期。書き込みは untrack で循環を断ち切る
$effect(() => {
	const y = yearStr;
	const m = monthStr;
	const d = dayStr;
	untrack(() => {
		if (y && m && d) {
			value = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
		} else {
			// #4729: 年 / 月 / 日 のどれかが欠けたら「日付として不成立」= 未設定。
			// 旧実装は部分空のとき前の値を保持していたが、未設定 option を選べるようにした結果
			// 「画面は空なのに hidden input には前の誕生日が残る」= 消したつもりが消えない、が起きる。
			value = undefined;
		}
	});
});

const daysInMonth = $derived.by(() => {
	if (!yearStr || !monthStr) return 31;
	// 月の日数は暦 SSOT に委譲する (#4120)
	return daysInMonthOfKey(`${yearStr}-${monthStr.padStart(2, '0')}`);
});

const dayOptions = $derived.by(() => {
	return Array.from({ length: daysInMonth }, (_, i) => ({
		value: String(i + 1),
		label: `${i + 1}${UI_PRIMITIVES_LABELS.dayUnit}`,
	}));
});

// 月変更で日数が減った場合、選択済みの日をリセット
$effect(() => {
	if (dayStr && Number(dayStr) > daysInMonth) {
		dayStr = String(daysInMonth);
	}
});

// #4729 PO 決定 (2026-09-04): 誕生日は任意入力なので「未設定に戻せる」。
// 年を未設定に戻したときに月 / 日が残ると、上の合成 effect の `!y && !m && !d` に到達せず
// value が前の日付のまま固まる (月 / 日の select は `disabled` になり自分では空に戻せない) ため、
// 上位が空になったら下位も連動して空にする。
$effect(() => {
	if (!yearStr && (monthStr || dayStr)) {
		monthStr = '';
		dayStr = '';
	} else if (!monthStr && dayStr) {
		dayStr = '';
	}
});

// 任意入力のときだけ「未設定」option を選べるようにする (#4729)。`required` 指定の callsite では
// 未選択に戻せると必須入力が成立しないため、従来どおり disabled のままにする。
const placeholderSelectable = $derived(!required);
</script>

<FormField {label} {id} {error} {required} {hint}>
	{#snippet children({ id: fieldId, 'aria-describedby': describedby })}
		<div class="birthday-input" aria-describedby={describedby}>
			<NativeSelect
				aria-label={UI_PRIMITIVES_LABELS.birthYearAriaLabel}
				bind:value={yearStr}
				options={yearOptions}
				placeholder={UI_PRIMITIVES_LABELS.birthYearPlaceholder}
				{placeholderSelectable}
				required={required}
			/>
			<NativeSelect
				aria-label={UI_PRIMITIVES_LABELS.birthMonthAriaLabel}
				bind:value={monthStr}
				options={monthOptions}
				placeholder={UI_PRIMITIVES_LABELS.birthMonthPlaceholder}
				{placeholderSelectable}
				disabled={!yearStr}
				required={required}
			/>
			<NativeSelect
				aria-label={UI_PRIMITIVES_LABELS.birthDayAriaLabel}
				bind:value={dayStr}
				options={dayOptions}
				placeholder={UI_PRIMITIVES_LABELS.birthDayPlaceholder}
				{placeholderSelectable}
				disabled={!monthStr}
				required={required}
			/>
		</div>
	{/snippet}
</FormField>

{#if name}<input type="hidden" {name} value={value ?? ''} {required} />{/if}

<style>
	.birthday-input {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
</style>
