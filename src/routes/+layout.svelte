<script lang="ts">
import '$lib/ui/styles/app.css';
import NavigationProgress from '$lib/ui/components/NavigationProgress.svelte';

let { children } = $props();
</script>

<svelte:head>
	<title>がんばりクエスト</title>
	<meta name="description" content="子供の活動をゲーミフィケーションで動機付けする家庭内Webアプリ" />
</svelte:head>

<NavigationProgress />
{@render children()}
