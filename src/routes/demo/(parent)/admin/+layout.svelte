<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import FeedbackDialog from '$lib/features/admin/components/FeedbackDialog.svelte';
import FeedbackFab from '$lib/ui/components/FeedbackFab.svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();

let showFeedback = $state(false);
</script>

<AdminLayout mode="demo" basePath="/demo/admin">
	{@render children()}
</AdminLayout>
<!-- #839: フィードバック FAB + ダイアログ（デモ版） -->
<FeedbackFab onclick={() => { showFeedback = true; }} />
<FeedbackDialog bind:open={showFeedback} isDemo />
