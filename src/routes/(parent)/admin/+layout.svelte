<script lang="ts">
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import type { Snippet } from 'svelte';

interface Props {
	data: { isPremium?: boolean };
	children: Snippet;
}

let { data, children }: Props = $props();
</script>

<AdminLayout mode="live" basePath="/admin" isPremium={data.isPremium ?? false}>
	{@render children()}
</AdminLayout>
