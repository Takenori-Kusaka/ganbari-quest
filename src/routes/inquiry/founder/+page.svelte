<script lang="ts">
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { APP_LABELS, FOUNDER_INQUIRY_LABELS, LP_COMMON_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { form } = $props();

const L = FOUNDER_INQUIRY_LABELS;

let submitting = $state(false);
let success = $derived(Boolean(form && 'success' in form && form.success));
let errorMessage = $derived(
	form && 'message' in form && typeof form.message === 'string' ? form.message : '',
);

interface FailValues {
	name: string;
	email: string;
	childAge: string;
	message: string;
}

const failValues = $derived<FailValues | null>(
	form && 'values' in form && form.values && typeof form.values === 'object'
		? (form.values as FailValues)
		: null,
);

const sourcePath = $derived($page.url.pathname);

// メールアドレスは LP_COMMON_LABELS と同じ SSOT を参照
const mailtoSubject = encodeURIComponent(`【${APP_LABELS.name}】${L.pageHeading}`);
const mailtoHref = `mailto:${LP_COMMON_LABELS.contactEmail}?subject=${mailtoSubject}`;
</script>

<svelte:head>
	<title>{L.pageTitle}{APP_LABELS.pageTitleSuffix}</title>
	<meta name="description" content={L.pageLead} />
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pt-6 pb-12">
	<header class="px-0 pt-3 pb-1 text-center">
		<h1 class="mb-3 text-[1.6rem] font-bold text-[var(--color-text)]">{L.pageHeading}</h1>
		<p class="m-0 text-base leading-relaxed text-[var(--color-text-secondary)]">{L.pageLead}</p>
	</header>

	{#if success}
		<Card>
			<div class="flex flex-col gap-4" data-testid="founder-inquiry-success">
				<Alert variant="success">
					<strong>{L.successHeading}</strong>
					<p class="mt-2 mb-0 leading-relaxed">{L.successText}</p>
				</Alert>
				<div class="flex justify-end">
					<Button href="/" variant="primary" size="md">{L.successCloseButton}</Button>
				</div>
			</div>
		</Card>
	{:else}
		<Card>
			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
				class="flex flex-col gap-4"
				data-testid="founder-inquiry-form"
			>
				<input type="hidden" name="sourcePath" value={sourcePath} />

				{#if errorMessage}
					<Alert variant="danger" data-testid="founder-inquiry-error">{errorMessage}</Alert>
				{/if}

				<FormField
					name="name"
					label={L.formNameLabel}
					placeholder={L.formNamePlaceholder}
					required
					value={failValues?.name ?? ''}
					data-testid="founder-inquiry-name"
				/>

				<FormField
					name="email"
					type="email"
					label={L.formEmailLabel}
					placeholder={L.formEmailPlaceholder}
					required
					value={failValues?.email ?? ''}
					data-testid="founder-inquiry-email"
				/>

				<FormField
					name="childAge"
					label={L.formChildAgeLabel}
					placeholder={L.formChildAgePlaceholder}
					value={failValues?.childAge ?? ''}
					data-testid="founder-inquiry-child-age"
				/>

				<FormField
					name="message"
					type="textarea"
					rows={8}
					label={L.formMessageLabel}
					placeholder={L.formMessagePlaceholder}
					required
					value={failValues?.message ?? ''}
					data-testid="founder-inquiry-message"
				/>

				<p class="m-0 rounded-md bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
					{L.pageNote}
				</p>

				<div class="mt-2 flex justify-end gap-2">
					<Button href="/" variant="ghost" size="md" disabled={submitting}>
						{L.formCancelButton}
					</Button>
					<Button
						type="submit"
						variant="primary"
						size="md"
						disabled={submitting}
						data-testid="founder-inquiry-submit"
					>
						{submitting ? L.formSubmittingText : L.formSubmitButton}
					</Button>
				</div>
			</form>
		</Card>

		<Card>
			<div class="flex flex-col gap-2">
				<h2 class="m-0 text-[1.1rem] font-semibold text-[var(--color-text)]">
					{L.mailtoSectionHeading}
				</h2>
				<p class="m-0 text-sm text-[var(--color-text-secondary)]">{L.mailtoSectionDesc}</p>
				<a
					class="break-all text-base text-[var(--color-text-link)] underline"
					href={mailtoHref}
					data-testid="founder-inquiry-mailto"
				>
					{LP_COMMON_LABELS.contactEmail}
				</a>
			</div>
		</Card>
	{/if}
</div>
