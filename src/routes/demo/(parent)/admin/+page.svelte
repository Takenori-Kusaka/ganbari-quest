<script lang="ts">
import AdminHome from '$lib/features/admin/components/AdminHome.svelte';

let { data } = $props();
</script>

<AdminHome
	children={data.children}
	pointSettings={data.pointSettings}
	mode="demo"
	basePath="/demo/admin"
/>
