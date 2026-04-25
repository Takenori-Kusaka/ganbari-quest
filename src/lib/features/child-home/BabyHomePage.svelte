<script lang="ts">
import { BABY_HOME_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

let {
	child,
	balance,
}: {
	child: { nickname: string; age: number; birthDate?: string | null };
	balance: number;
} = $props();

const ageInfo = $derived.by(() => {
	if (!child)
		return { months: 0, weeksUntil3: 36, monthsUntil3: 36, hasDate: false, reached: false };
	if (child.birthDate) {
		const birth = new Date(child.birthDate);
		const now = new Date();
		const months =
			(now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
		const thirdBirthday = new Date(birth.getFullYear() + 3, birth.getMonth(), birth.getDate());
		const msUntil3 = thirdBirthday.getTime() - now.getTime();
		const weeksUntil3 = Math.max(0, Math.ceil(msUntil3 / (1000 * 60 * 60 * 24 * 7)));
		const monthsUntil3 = Math.max(0, Math.ceil(msUntil3 / (1000 * 60 * 60 * 24 * 30.44)));
		return { months, weeksUntil3, monthsUntil3, hasDate: true, reached: msUntil3 <= 0 };
	}
	const months = child.age * 12;
	const monthsUntil3 = Math.max(0, (3 - child.age) * 12);
	return {
		months,
		weeksUntil3: monthsUntil3 * 4,
		monthsUntil3,
		hasDate: false,
		reached: child.age >= 3,
	};
});
</script>

{#if child}
<div
	class="baby-home px-[var(--sp-md)] py-[var(--sp-sm)] flex flex-col gap-[var(--sp-md)]"
	data-testid="baby-home-page"
>
	<p class="text-sm text-[var(--color-text-muted)] text-center">{BABY_HOME_LABELS.parentNote}</p>

	<Card>
		<div class="flex flex-col gap-3 text-center py-2">
			<p class="text-4xl" aria-hidden="true">👶</p>
			<h2 class="text-xl font-bold text-[var(--color-text)]">{BABY_HOME_LABELS.waitingTitle}</h2>
			<p class="text-sm text-[var(--color-text-secondary)]">{BABY_HOME_LABELS.waitingDesc}</p>

			{#if ageInfo.months > 0 || child.age > 0}
				<div class="mt-2 flex flex-col gap-1 items-center">
					<span class="text-sm font-medium text-[var(--color-text)]">
						{ageInfo.months < 12
							? BABY_HOME_LABELS.ageMonthsLabel(ageInfo.months)
							: BABY_HOME_LABELS.ageYearsLabel(child.age)}
					</span>
					{#if !ageInfo.reached}
						<span class="text-xs text-[var(--color-text-muted)]">
							{BABY_HOME_LABELS.countdownLabel}
							{ageInfo.monthsUntil3 > 2
								? BABY_HOME_LABELS.countdownMonthsText(ageInfo.monthsUntil3)
								: BABY_HOME_LABELS.countdownWeeksText(ageInfo.weeksUntil3)}
						</span>
					{:else}
						<span class="text-xs text-[var(--color-action-success)]"
							>{BABY_HOME_LABELS.countdownReachedText}</span
						>
					{/if}
				</div>
			{/if}
		</div>
	</Card>

	<Card>
		<div class="flex flex-col gap-3 py-2">
			<h3 class="text-base font-bold text-[var(--color-text)]">
				{BABY_HOME_LABELS.initialPointsTitle}
			</h3>
			<p class="text-sm text-[var(--color-text-secondary)]">{BABY_HOME_LABELS.initialPointsDesc}</p>
			{#if balance > 0}
				<p class="text-sm font-medium text-[var(--color-text)]">
					{BABY_HOME_LABELS.currentPoints(balance)}
				</p>
			{/if}
			<Button
				href="/baby/home/initial-points"
				variant="primary"
				size="md"
				data-testid="initial-points-link"
			>
				{BABY_HOME_LABELS.initialPointsLinkLabel}
			</Button>
		</div>
	</Card>

	<div class="flex justify-center pt-2">
		<Button
			href="/admin"
			variant="ghost"
			size="sm"
			data-testid="baby-home-admin-link"
		>
			{BABY_HOME_LABELS.goToAdmin}
		</Button>
	</div>
</div>
{/if}
