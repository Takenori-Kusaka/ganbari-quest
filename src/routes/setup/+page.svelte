<script lang="ts">
import { APP_LABELS, PAGE_TITLES, UI_LABELS } from '$lib/domain/labels';
</script>

<!-- #0262: PIN設定はセットアップから除去。サーバーで /setup/children にリダイレクト -->
<svelte:head>
	<title>{PAGE_TITLES.setup}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<p>{UI_LABELS.redirecting}</p>
