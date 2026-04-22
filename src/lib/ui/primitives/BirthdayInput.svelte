<script lang="ts">
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

// Initialize from value prop
$effect(() => {
	if (value) {
		const [y, m, d] = value.split('-');
		yearStr = y ?? '';
		monthStr = m ? String(Number(m)) : '';
		dayStr = d ? String(Number(d)) : '';
	} else {
		yearStr = '';
		monthStr = '';
		dayStr = '';
	}
});

// Update value prop when selections change
$effect(() => {
	if (yearStr && monthStr && dayStr) {
		const m = monthStr.padStart(2, '0');
		const d = dayStr.padStart(2, '0');
		value = `${yearStr}-${m}-${d}`;
	} else if (!yearStr && !monthStr && !dayStr) {
		value = undefined;
	}
});

const daysInMonth = $derived(() => {
	if (!yearStr || !monthStr) return 31;
	return new Date(Number(yearStr), Number(monthStr), 0).getDate();
});

const dayOptions = $derived(() => {
	return Array.from({ length: daysInMonth() }, (_, i) => ({
		value: String(i + 1),
		label: `${i + 1}日`,
	}));
});

// Reset day if it becomes invalid
$effect(() => {
	if (dayStr && Number(dayStr) > daysInMonth()) {
		dayStr = String(daysInMonth());
	}
});
</script>

<FormField {label} {id} {error} {required} {hint}>
	{#snippet children({ id: fieldId, 'aria-describedby': describedby })}
		<div class="birthday-input" aria-describedby={describedby}>
			<NativeSelect
				aria-label="Year of birth"
				bind:value={yearStr}
				options={yearOptions}
				placeholder="----年"
				required={required}
			/>
			<NativeSelect
				aria-label="Month of birth"
				bind:value={monthStr}
				options={monthOptions}
				placeholder="--月"
				disabled={!yearStr}
				required={required}
			/>
			<NativeSelect
				aria-label="Day of birth"
				bind:value={dayStr}
				options={dayOptions()}
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
