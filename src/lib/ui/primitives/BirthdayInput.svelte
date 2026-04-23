<script lang="ts">
import { untrack } from 'svelte';
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
	label = 'おたんじょうび',
	value = $bindable(),
	name,
	id,
	required,
	error,
	hint,
}: Props = $props();

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 19 }, (_, i) => currentYear - i);
const yearOptions = years.map((y) => ({ value: String(y), label: `${y}年` }));

const monthOptions = Array.from({ length: 12 }, (_, i) => ({
	value: String(i + 1),
	label: `${i + 1}月`,
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
		} else if (!y && !m && !d) {
			value = undefined;
		}
	});
});

const daysInMonth = $derived.by(() => {
	if (!yearStr || !monthStr) return 31;
	return new Date(Number(yearStr), Number(monthStr), 0).getDate();
});

const dayOptions = $derived.by(() => {
	return Array.from({ length: daysInMonth }, (_, i) => ({
		value: String(i + 1),
		label: `${i + 1}日`,
	}));
});

// 月変更で日数が減った場合、選択済みの日をリセット
$effect(() => {
	if (dayStr && Number(dayStr) > daysInMonth) {
		dayStr = String(daysInMonth);
	}
});
</script>

<FormField {label} {id} {error} {required} {hint}>
	{#snippet children({ id: fieldId, 'aria-describedby': describedby })}
		<div class="birthday-input" aria-describedby={describedby}>
			<NativeSelect
				aria-label="生まれた年"
				bind:value={yearStr}
				options={yearOptions}
				placeholder="----年"
				required={required}
			/>
			<NativeSelect
				aria-label="生まれた月"
				bind:value={monthStr}
				options={monthOptions}
				placeholder="--月"
				disabled={!yearStr}
				required={required}
			/>
			<NativeSelect
				aria-label="生まれた日"
				bind:value={dayStr}
				options={dayOptions}
				placeholder="--日"
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
