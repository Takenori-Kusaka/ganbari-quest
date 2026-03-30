<script lang="ts">
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();
</script>

<AdminLayout mode="live" basePath="/admin">
	{@render children()}
</AdminLayout>
