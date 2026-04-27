<script lang="ts">
import { page } from '$app/stores';
import { UI_COMPONENTS_LABELS } from '$lib/domain/labels';
import { markTutorialStarted, startTutorialForPage } from '$lib/ui/tutorial/tutorial-store.svelte';

async function handleClick() {
	await markTutorialStarted();
	await startTutorialForPage($page.url.pathname);
}
</script>

<button
	type="button"
	class="page-help-btn"
	onclick={handleClick}
	title={UI_COMPONENTS_LABELS.pageHelpButtonTitle}
	aria-label={UI_COMPONENTS_LABELS.pageHelpButtonAriaLabel}
>
	?
</button>

<style>
.page-help-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: 9999px;
	border: 1.5px solid var(--color-border-default);
	background: var(--color-surface-card);
	color: var(--color-text-muted);
	font-weight: 700;
	font-size: 0.875rem;
	cursor: pointer;
	transition: all 0.15s;
}
.page-help-btn:hover {
	background: var(--color-brand-50, #eff6ff);
	border-color: var(--color-brand-300, #93c5fd);
	color: var(--color-brand-600);
}
</style>
