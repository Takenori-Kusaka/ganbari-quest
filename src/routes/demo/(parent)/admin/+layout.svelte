<script lang="ts">
import type { Snippet } from 'svelte';
import AdminLayout from '$lib/features/admin/components/AdminLayout.svelte';
import FeedbackDialog from '$lib/features/admin/components/FeedbackDialog.svelte';

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
<button
	type="button"
	class="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-20
		w-12 h-12 rounded-full shadow-lg
		bg-[var(--color-action-primary)] text-[var(--color-text-inverse)]
		flex items-center justify-center text-xl
		hover:opacity-90 transition-opacity"
	onclick={() => { showFeedback = true; }}
	aria-label="ご意見・不具合報告"
	data-testid="feedback-fab"
>
	💬
</button>
<FeedbackDialog bind:open={showFeedback} isDemo />
