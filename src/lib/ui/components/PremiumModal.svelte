<!--
	@deprecated Use PremiumDialog.svelte instead. Renamed in #1193 to align with Dialog primitive naming.
	This re-export stub will be removed in a future release (ADR-0001).
-->
<script lang="ts">
import PremiumDialog from './PremiumDialog.svelte';

interface Props {
	onclose: () => void;
}

let { onclose }: Props = $props();
</script>

<PremiumDialog {onclose} />
