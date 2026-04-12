<script lang="ts">
// #839: フィードバック FAB（Floating Action Button）
// admin / demo/admin レイアウト共通コンポーネント
import IconButton from '$lib/ui/primitives/IconButton.svelte';

interface Props {
	onclick: () => void;
}

let { onclick }: Props = $props();
</script>

<div class="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-20">
	<IconButton
		variant="primary"
		size="lg"
		label="ご意見・不具合報告"
		class="!rounded-full shadow-lg !p-3"
		{onclick}
		data-testid="feedback-fab"
	>
		<span class="text-xl">💬</span>
	</IconButton>
</div>
