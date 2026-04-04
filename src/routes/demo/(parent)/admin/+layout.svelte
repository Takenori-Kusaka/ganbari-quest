<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();
</script>

<AdminLayout mode="demo" basePath="/demo/admin">
	{@render children()}
</AdminLayout>
