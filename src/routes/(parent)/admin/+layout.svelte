<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
	children: Snippet;
}

let { children }: Props = $props();

const navItems = [
	{ href: '/admin', label: 'ホーム', icon: '🏠' },
	{ href: '/admin/children', label: 'こども', icon: '👧' },
	{ href: '/admin/activities', label: 'かつどう', icon: '📋' },
	{ href: '/admin/checklists', label: 'もちもの', icon: '✅' },
	{ href: '/admin/rewards', label: 'ごほうび', icon: '🎁' },
	{ href: '/admin/points', label: 'ポイント', icon: '⭐' },
	{ href: '/admin/achievements', label: 'じっせき', icon: '🏆' },
	{ href: '/admin/status', label: 'ステータス', icon: '📊' },
	{ href: '/admin/settings', label: 'せってい', icon: '⚙️' },
];
</script>

<div data-theme="admin" class="min-h-dvh bg-gradient-to-b from-blue-50 to-blue-100">
	<!-- Admin Header -->
	<header class="sticky top-0 z-30 bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-3">
		<div class="max-w-4xl mx-auto flex items-center justify-between">
			<h1 class="text-lg font-bold text-gray-700">がんばりクエスト 管理</h1>
			<form method="POST" action="/api/v1/auth/logout">
				<button
					type="submit"
					class="text-sm px-3 py-1 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 transition-colors"
				>
					ログアウト
				</button>
			</form>
		</div>
	</header>

	<!-- Admin Navigation -->
	<nav class="bg-white border-b border-gray-100 px-4 py-2 overflow-x-auto">
		<div class="max-w-4xl mx-auto flex gap-1">
			{#each navItems as item}
				<a
					href={item.href}
					class="flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors whitespace-nowrap"
				>
					<span aria-hidden="true">{item.icon}</span>
					{item.label}
				</a>
			{/each}
		</div>
	</nav>

	<!-- Main content -->
	<main class="max-w-4xl mx-auto p-4">
		{@render children()}
	</main>
</div>
