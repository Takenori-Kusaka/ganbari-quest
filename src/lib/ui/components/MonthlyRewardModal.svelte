<!--
	@deprecated Use MonthlyRewardDialog.svelte instead. Renamed in #1193 to align with Dialog primitive naming.
	This re-export stub will be removed in a future release (ADR-0001).
-->
<script lang="ts">
import MonthlyRewardDialog from './MonthlyRewardDialog.svelte';

interface Props {
	eventId: number;
	rewardName: string;
	rewardIcon: string;
	rewardDescription: string;
	claimed: boolean;
	onClaimed?: () => void;
}

let { eventId, rewardName, rewardIcon, rewardDescription, claimed, onClaimed }: Props = $props();
</script>

<MonthlyRewardDialog {eventId} {rewardName} {rewardIcon} {rewardDescription} {claimed} {onClaimed} />
