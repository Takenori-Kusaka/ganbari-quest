<script lang="ts">
import CharacterTabs from '$lib/features/character/CharacterTabs.svelte';
import type { Snippet } from 'svelte';

let { data, children }: { data: { uiMode: string }; children: Snippet } = $props();
</script>

<CharacterTabs uiMode={data.uiMode ?? 'kinder'} />
{@render children()}
