<script lang="ts">
// #2324 (EPIC #2319 ⑤): support グループ — feedback / appInfo
// #support-unify: 旧「開発者に直接相談」CTA カードと「フィードバック」カードの 2 セクション分離を解消し、
// 単一フォーム内で「ご用件」(感想・要望 / 相談・困りごと) を intent ラジオで選ぶ構成へ統合。
// 競合フォーム research: 単一フォーム + intent セレクタ + 段階表示 (progressive disclosure) が支配的。
// founder 直接相談の独立ページ (/inquiry/founder) は LP / ライセンス導線から到達するため存続。

import { enhance } from '$app/forms';
import { APP_LABELS, PAGE_TITLES, SETTINGS_LABELS } from '$lib/domain/labels';
import { ErrorAlert, SuccessAlert } from '$lib/ui/components';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';
import NativeSelect from '$lib/ui/primitives/NativeSelect.svelte';
import { APP_VERSION } from '$lib/version';

let { form, data } = $props();

type FeedbackIntent = 'feedback' | 'consult';

let feedbackSuccess = $state(false);
let feedbackSubmitting = $state(false);
let feedbackIntent = $state<FeedbackIntent>('feedback');
let feedbackCategory = $state('feature');
let feedbackChildAge = $state('');
let feedbackText = $state('');
let feedbackEmail = $state('');
let feedbackInquiryId = $state('');
let feedbackSuccessIntent = $state<FeedbackIntent>('feedback');
let feedbackSuccessHadEmail = $state(false);

const isConsult = $derived(feedbackIntent === 'consult');
// 相談 (返信前提) で、かつアカウントメールが無いときのみ返信先を必須にする。
// アカウントメールがあればサーバ側で fallback されるため入力は任意 (別アドレス希望時のみ)。
const replyRequired = $derived(isConsult && !data.accountEmail);
const replyHint = $derived(
	isConsult
		? data.accountEmail
			? SETTINGS_LABELS.feedbackReplyHintConsultWithAccount(data.accountEmail)
			: SETTINGS_LABELS.feedbackReplyHintConsultNoAccount
		: SETTINGS_LABELS.feedbackReplyHintFeedback,
);
const replyLabel = $derived(
	replyRequired
		? SETTINGS_LABELS.feedbackReplyEmailLabel
		: `${SETTINGS_LABELS.feedbackReplyEmailLabel}${SETTINGS_LABELS.feedbackReplyEmailOptionalSuffix}`,
);
const successMessage = $derived(
	feedbackSuccessIntent === 'consult'
		? SETTINGS_LABELS.feedbackSuccessConsult(feedbackInquiryId)
		: feedbackInquiryId
			? `${SETTINGS_LABELS.feedbackSuccessFeedbackWithId(feedbackInquiryId)}${feedbackSuccessHadEmail ? SETTINGS_LABELS.feedbackSuccessFeedbackEmailNote : ''}`
			: SETTINGS_LABELS.feedbackSuccessFeedbackNoId,
);
</script>

<svelte:head>
	<title>{SETTINGS_LABELS.groupSupportTitle} | {PAGE_TITLES.settings}{APP_LABELS.pageTitleSuffix}</title>
</svelte:head>

<div class="space-y-6">
	<!-- #support-unify: 単一サポートフォーム (ご用件 intent + 内容分類 + 段階表示) -->
	<Card padding="lg" data-tutorial="feedback-section">
		<h3 class="text-lg font-bold text-[var(--color-text)] mb-2">
			{SETTINGS_LABELS.feedbackSectionTitle}
		</h3>
		<p class="text-sm text-[var(--color-text-secondary)] leading-relaxed mb-4">
			{SETTINGS_LABELS.feedbackSectionDesc}
		</p>

		{#if feedbackSuccess}
			<SuccessAlert message={successMessage} />
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
				const submittedIntent = feedbackIntent;
				const submittedHadEmail = feedbackEmail.length > 0;
				return async ({ result, update }) => {
					feedbackSubmitting = false;
					if (result.type === 'success') {
						feedbackSuccess = true;
						feedbackSuccessIntent = submittedIntent;
						feedbackSuccessHadEmail = submittedHadEmail;
						feedbackInquiryId =
							(result.data as { inquiryId?: string })?.inquiryId ?? '';
						feedbackText = '';
						feedbackCategory = 'feature';
						feedbackChildAge = '';
						feedbackEmail = '';
					}
					await update();
				};
			}}
			class="flex flex-col gap-4"
		>
			<!-- ご用件 (intent) — 返信要否を分岐する 2 軸ラジオ。fieldset/legend で a11y を担保。 -->
			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm font-medium text-[var(--color-text)] mb-1">
					{SETTINGS_LABELS.feedbackIntentLabel}
				</legend>
				<label class="flex items-center gap-2 text-sm text-[var(--color-text)]">
					<input
						type="radio"
						name="intent"
						value="feedback"
						bind:group={feedbackIntent}
						class="accent-[var(--color-action-primary)]"
					/>
					{SETTINGS_LABELS.feedbackIntentFeedback}
				</label>
				<label class="flex items-center gap-2 text-sm text-[var(--color-text)]">
					<input
						type="radio"
						name="intent"
						value="consult"
						bind:group={feedbackIntent}
						class="accent-[var(--color-action-primary)]"
					/>
					{SETTINGS_LABELS.feedbackIntentConsult}
				</label>
			</fieldset>

			<!-- 感想・要望のときのみ「種類」を出す (progressive disclosure) -->
			{#if !isConsult}
				<NativeSelect
					id="feedbackCategory"
					name="category"
					label={SETTINGS_LABELS.feedbackCategoryLabel}
					bind:value={feedbackCategory}
					options={[
						{ value: 'feature', label: SETTINGS_LABELS.feedbackCategoryFeature },
						{ value: 'bug', label: SETTINGS_LABELS.feedbackCategoryBug },
						{ value: 'other', label: SETTINGS_LABELS.feedbackCategoryOther },
					]}
				/>
			{/if}

			<!-- 相談のときのみお子さまの年齢を任意で聞く (単一・任意フィールドの段階表示) -->
			{#if isConsult}
				<FormField
					label={SETTINGS_LABELS.feedbackChildAgeLabel}
					type="text"
					id="feedbackChildAge"
					name="childAge"
					bind:value={feedbackChildAge}
					placeholder={SETTINGS_LABELS.feedbackChildAgePlaceholder}
					maxlength={100}
					hint={SETTINGS_LABELS.feedbackChildAgeHint}
				/>
			{/if}

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
				label={replyLabel}
				type="email"
				id="feedbackEmail"
				name="email"
				bind:value={feedbackEmail}
				placeholder="reply@example.com"
				maxlength={254}
				required={replyRequired}
				hint={replyHint}
			/>

			<Button
				type="submit"
				variant="primary"
				size="md"
				class="w-full"
				disabled={feedbackSubmitting || feedbackText.length === 0}
			>
				{feedbackSubmitting
					? SETTINGS_LABELS.feedbackSubmittingText
					: SETTINGS_LABELS.feedbackSubmitButton}
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
