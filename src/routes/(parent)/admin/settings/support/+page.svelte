<script lang="ts">
// #2324 (EPIC #2319 ⑤): support グループ — founderInquiry / feedback / appInfo
// 旧 /admin/settings/+page.svelte 行 1776 (founderInquiry) / 1792 (feedback) / 1885 (appInfo) を移行。

import { enhance } from '$app/forms';
import {
	APP_LABELS,
	FOUNDER_INQUIRY_LABELS,
	PAGE_TITLES,
	SETTINGS_LABELS,
} from '$lib/domain/labels';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import { APP_VERSION } from '$lib/version';

let { form } = $props();

let feedbackSuccess = $state(false);
let feedbackSubmitting = $state(false);
let feedbackCategory = $state('feature');
let feedbackText = $state('');
let feedbackEmail = $state('');
let feedbackInquiryId = $state('');
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupSupportTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- founder 1:1 ヒアリング動線 (#1594 ADR-0023 I8) -->
	<Card padding="lg" data-testid="admin-founder-inquiry-cta">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-3">
			{FOUNDER_INQUIRY_LABELS.ctaSectionHeading}
		</h3>
		<p class="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-3">
			{FOUNDER_INQUIRY_LABELS.ctaSectionLead}
		</p>
		<ul
			class="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4 list-disc pl-5 space-y-1"
		>
			<li>{FOUNDER_INQUIRY_LABELS.ctaSectionBullet1}</li>
			<li>{FOUNDER_INQUIRY_LABELS.ctaSectionBullet2}</li>
			<li>{FOUNDER_INQUIRY_LABELS.ctaSectionBullet3}</li>
		</ul>
		<Button
			href="/inquiry/founder"
			variant="primary"
			size="md"
			data-testid="admin-founder-inquiry-link"
		>
			{FOUNDER_INQUIRY_LABELS.ctaButton}
		</Button>
	</Card>

	<!-- フィードバック -->
	<Card padding="lg" data-tutorial="feedback-section">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.feedbackSectionTitle}
		</h3>

		{#if feedbackSuccess}
			<SuccessAlert
				message={feedbackInquiryId
					? `お問い合わせを受け付けました。受付番号: ${feedbackInquiryId}\n${feedbackEmail ? '入力いただいたメールアドレスに確認メールをお送りしました。' : ''}`
					: 'お問い合わせありがとうございます。今後の参考とさせていただきます。'}
			/>
		{/if}

		{#if form?.feedbackError}
			<ErrorAlert message={form.feedbackError} severity="warning" action="fix_input" />
		{/if}

		<form
			method="POST"
			action="?/sendFeedback"
			use:enhance={() => {
				feedbackSubmitting = true;
				feedbackSuccess = false;
				feedbackInquiryId = '';
				return async ({ result, update }) => {
					feedbackSubmitting = false;
					if (result.type === 'success') {
						feedbackSuccess = true;
						feedbackInquiryId =
							(result.data as { inquiryId?: string })?.inquiryId ?? '';
						feedbackText = '';
						feedbackCategory = 'feature';
						feedbackEmail = '';
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<NativeSelect
				id="feedbackCategory"
				name="category"
				label="カテゴリ"
				bind:value={feedbackCategory}
				options={[
					{ value: 'feature', label: '機能要望' },
					{ value: 'bug', label: 'バグ報告' },
					{ value: 'other', label: 'その他' },
				]}
			/>

			<div>
				<label
					for="feedbackText"
					class="block text-sm font-medium text-[var(--color-text)] mb-1"
				>
					{SETTINGS_LABELS.feedbackContentLabel}
				</label>
				<textarea
					id="feedbackText"
					name="text"
					bind:value={feedbackText}
					rows="4"
					maxlength="1000"
					required
					placeholder={SETTINGS_LABELS.feedbackContentPlaceholder}
					class="w-full px-3 py-2 border border-[var(--color-border-strong)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)] resize-y"
				></textarea>
				<p class="text-xs text-[var(--color-text-muted)] mt-1 text-right">
					{feedbackText.length}/1000
				</p>
			</div>

			<FormField
				label="返信先メールアドレス（任意）"
				type="email"
				id="feedbackEmail"
				name="email"
				bind:value={feedbackEmail}
				placeholder="reply@example.com"
				maxlength={254}
				hint="ご入力いただいた場合、内容によってはメールでご返信する場合があります"
			/>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={feedbackSubmitting || feedbackText.length === 0}
			>
				{feedbackSubmitting ? '送信中...' : 'フィードバックを送信'}
			</Button>
		</form>
		<p class="text-xs text-[var(--color-text-muted)] mt-3 text-center">
			{SETTINGS_LABELS.feedbackContactNote}
			<a
				href="mailto:ganbari.quest.support@gmail.com"
				class="text-[var(--color-brand-500)] hover:underline"
				>{SETTINGS_LABELS.feedbackContactLinkLabel}</a
			>
			{SETTINGS_LABELS.feedbackContactSuffix}
		</p>
	</Card>

	<!-- アプリ情報・リンク -->
	<Card padding="lg">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-4">
			{SETTINGS_LABELS.appInfoSectionTitle}
		</h3>
		<ul class="space-y-3 text-sm">
			<li>
				<a
					href="https://www.ganbari-quest.com/terms.html"
					target="_blank"
					rel="noopener"
					class="text-[var(--color-brand-500)] hover:underline"
					>{SETTINGS_LABELS.appInfoTermsLink}</a
				>
			</li>
			<li>
				<a
					href="https://www.ganbari-quest.com/privacy.html"
					target="_blank"
					rel="noopener"
					class="text-[var(--color-brand-500)] hover:underline"
					>{SETTINGS_LABELS.appInfoPrivacyLink}</a
				>
			</li>
			<li>
				<a
					href="mailto:ganbari.quest.support@gmail.com"
					class="text-[var(--color-brand-500)] hover:underline"
					>{SETTINGS_LABELS.appInfoContactLink}</a
				>
			</li>
			<li>
				<a
					href="https://github.com/Takenori-Kusaka/ganbari-quest"
					target="_blank"
					rel="noopener noreferrer"
					class="text-[var(--color-brand-500)] hover:underline"
					>{SETTINGS_LABELS.appInfoGithubLink}</a
				>
			</li>
			<li>
				<span class="text-[var(--color-text-muted)]"
					>{SETTINGS_LABELS.appInfoVersionLabel}{APP_VERSION}</span
				>
			</li>
		</ul>
	</Card>
</div>
