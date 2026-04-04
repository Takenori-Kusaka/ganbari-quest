<script lang="ts">
import DemoBanner from '$lib/features/admin/components/DemoBanner.svelte';
import DemoCta from '$lib/features/admin/components/DemoCta.svelte';
</script>

<svelte:head>
	<title>チャレンジ管理 - がんばりクエスト デモ</title>
</svelte:head>

<div class="space-y-6">
	<DemoBanner />

	<div class="text-center py-12 text-[var(--color-text-muted)]">
		<span class="text-5xl mb-4 block">📋</span>
		<p class="text-lg font-bold mb-2">チャレンジ管理</p>
		<p class="text-sm">チャレンジ機能は今後リリース予定です</p>
	</div>

	<DemoCta
		title="お子さまの成長をサポートしませんか？"
		description="登録すると、チャレンジやカスタム実績の管理ができます。"
	/>
</div>
