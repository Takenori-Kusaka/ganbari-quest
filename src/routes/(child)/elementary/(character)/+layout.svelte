<script lang="ts">
import type { Snippet } from 'svelte';
import CharacterTabs from '$lib/features/character/CharacterTabs.svelte';

let { data, children }: { data: { uiMode: string }; children: Snippet } = $props();
</script>

<CharacterTabs uiMode={data.uiMode ?? 'elementary'} />
{@render children()}
