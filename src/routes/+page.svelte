<script lang="ts">
	// Root page - redirects to child home
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/home');
	});
</script>

<p>リダイレクト中...</p>
