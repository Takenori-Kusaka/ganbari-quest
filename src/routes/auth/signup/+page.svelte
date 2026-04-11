<script lang="ts">
import { onDestroy } from 'svelte';
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import {
	LICENSE_KEY_LEGACY_FORMAT,
	LICENSE_KEY_SIGNED_FORMAT,
	SIGNUP_CODE_EXPIRY_MINUTES,
} from '$lib/domain/validation/auth';
import GoogleSignInButton from '$lib/ui/components/GoogleSignInButton.svelte';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Dialog from '$lib/ui/primitives/Dialog.svelte';
import Divider from '$lib/ui/primitives/Divider.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { form } = $props();

let email = $state('');
let password = $state('');
let passwordConfirm = $state('');
let licenseKeyRaw = $state('');
const licenseKey = $derived(licenseKeyRaw.toUpperCase().trim());
const licenseKeyValid = $derived(
	licenseKey === '' ||
		LICENSE_KEY_LEGACY_FORMAT.test(licenseKey) ||
		LICENSE_KEY_SIGNED_FORMAT.test(licenseKey),
);
const licenseKeyError = $derived(
	licenseKeyRaw && !licenseKeyValid
		? 'GQ-XXXX-XXXX-XXXX または GQ-XXXX-XXXX-XXXX-XXXXX 形式で入力してください'
		: undefined,
);
let codeRaw = $state('');
const code = $derived(codeRaw.replace(/\s/g, ''));
let loading = $state(false);
let resending = $state(false);
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let showLicenseKey = $state(false);

// #799 ライセンスキー使用時の追加ガード
let agreedLicenseOnce = $state(false); // 「一回限り使用に同意」
let showLicenseHelp = $state(false); // 折りたたみヘルプの開閉
let showLicenseConfirmDialog = $state(false); // 確認ダイアログ
let signupFormEl: HTMLFormElement | null = $state(null); // dialog から submit を呼ぶため

// #588: 規約リンク閲覧追跡（一度クリックして開くまでチェック不可）
let termsViewed = $state(false);
let privacyViewed = $state(false);
let termsHintShown = $state(false);
let privacyHintShown = $state(false);

// #588: フォーム送信試行追跡（未入力フィールドのエラー表示用）
let submitAttempted = $state(false);

// #588: 送信可能かの判定
// #799: showLicenseKey 時は「一回限り使用に同意」も必須
const canSubmit = $derived(
	!loading &&
		!!email &&
		!!password &&
		!!passwordConfirm &&
		password === passwordConfirm &&
		agreedTerms &&
		agreedPrivacy &&
		(!showLicenseKey || (!!licenseKey && licenseKeyValid && agreedLicenseOnce)),
);

// #588: 送信不可理由
const submitBlockReason = $derived(() => {
	if (!email) return 'メールアドレスを入力してください';
	if (!password) return 'パスワードを入力してください';
	if (!passwordConfirm) return 'パスワード（確認）を入力してください';
	if (password !== passwordConfirm) return 'パスワードが一致しません';
	if (!agreedTerms) return '利用規約への同意が必要です';
	if (!agreedPrivacy) return 'プライバシーポリシーへの同意が必要です';
	if (showLicenseKey && (!licenseKey || !licenseKeyValid))
		return 'ライセンスキーを正しく入力してください';
	if (showLicenseKey && !agreedLicenseOnce)
		return 'ライセンスキーが一回限り使用であることに同意してください';
	return '';
});

// 再送クールダウン（60秒）
let resendCooldown = $state(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;
let messageTimeout: ReturnType<typeof setTimeout> | null = null;
let resendSuccess = $state(false);

// コンポーネント破棄時にタイマーをクリーンアップ
onDestroy(() => {
	if (cooldownTimer) clearInterval(cooldownTimer);
	if (messageTimeout) clearTimeout(messageTimeout);
});

function startCooldown() {
	resendCooldown = 60;
	if (cooldownTimer) clearInterval(cooldownTimer);
	cooldownTimer = setInterval(() => {
		resendCooldown -= 1;
		if (resendCooldown <= 0) {
			resendCooldown = 0;
			if (cooldownTimer) {
				clearInterval(cooldownTimer);
				cooldownTimer = null;
			}
		}
	}, 1000);
}

// URL の plan パラメータ（pricing ページからの遷移用）
const planParam = $derived($page.url.searchParams.get('plan'));

let confirmStep = $derived(form?.confirmStep ?? false);

// サーバーレスポンス（form）からフォーム値を復元
$effect(() => {
	if (typeof form?.email === 'string') email = form.email;
	if (typeof form?.licenseKey === 'string') {
		licenseKeyRaw = form.licenseKey;
		if (form.licenseKey) showLicenseKey = true;
	}
});

// 再送成功時にクールダウン開始
$effect(() => {
	if (form && 'resent' in form && form.resent) {
		resendSuccess = true;
		startCooldown();
		// 3秒後に成功メッセージを消す
		if (messageTimeout) clearTimeout(messageTimeout);
		messageTimeout = setTimeout(() => {
			resendSuccess = false;
		}, 3000);
	}
});
</script>

<svelte:head>
	<title>アカウント登録 - がんばりクエスト</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<Card padding="none" class="w-full max-w-[400px] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
		{#snippet children()}
		<div class="text-center mb-8">
			<Logo variant="full" size={320} />
		</div>

		{#if form?.error}
			<div class="mb-4 p-3 bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-200)] rounded-[var(--radius-sm)] text-sm" role="alert">
				{form.error}
			</div>
		{/if}

		{#if confirmStep}
			<!-- メール認証コード入力 -->
			<form
				method="POST"
				action="?/confirm"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						await update();
					};
				}}
				class="flex flex-col gap-5"
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="password" value={password} />
				<input type="hidden" name="licenseKey" value={licenseKey} />
				<input type="hidden" name="plan" value={planParam ?? ''} />

				<p class="text-sm text-[var(--color-text-muted)] text-center leading-relaxed">
					<strong>{email}</strong> に確認コードを送信しました。<br />
					メールに記載された6桁のコードを入力してください。
				</p>

				<p class="text-xs text-[var(--color-text-muted)] text-center">
					確認コードは{SIGNUP_CODE_EXPIRY_MINUTES}分以内に入力してください
				</p>

				<FormField label="確認コード" id="code">
					{#snippet children()}
						<input
							id="code"
							name="code"
							type="text"
							bind:value={codeRaw}
							placeholder="123456"
							required
							inputmode="numeric"
							autocomplete="one-time-code"
							class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-2xl text-center tracking-[0.5em] font-mono
								focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
						/>
					{/snippet}
				</FormField>

				<Button type="submit" disabled={loading || code.length < 1} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						確認中...
					{:else}
						確認する
					{/if}
				</Button>
			</form>

			{#if resendSuccess}
				<div class="mt-3 p-3 bg-[var(--color-feedback-success-bg)] text-[var(--color-feedback-success-text)] border border-[var(--color-feedback-success-border)] rounded-[var(--radius-sm)] text-sm text-center" role="status">
					確認コードを再送しました
				</div>
			{/if}

			<form
				method="POST"
				action="?/resend"
				use:enhance={() => {
					resending = true;
					return async ({ update }) => {
						resending = false;
						await update({ reset: false });
					};
				}}
				class="mt-4 text-center"
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="licenseKey" value={licenseKey} />
				<input type="hidden" name="plan" value={planParam ?? ''} />
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					disabled={resending || resendCooldown > 0}
				>
					{#if resending}
						再送中...
					{:else if resendCooldown > 0}
						コードを再送する（{resendCooldown}秒後に再試行可能）
					{:else}
						コードを再送する
					{/if}
				</Button>
			</form>
		{:else}
			<!-- Google OAuth サインアップ -->
			<GoogleSignInButton label="Google で登録" href="/auth/oauth/google" />
			<Divider label="または" spacing="sm" />

			<!-- 登録フォーム -->
			<form
				bind:this={signupFormEl}
				method="POST"
				action="?/signup"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						loading = false;
						passwordConfirm = '';
						await update({ reset: false });
					};
				}}
				class="flex flex-col gap-5"
			>
				<!-- #766: /pricing からの遷移で plan パラメータを確認アクションまで引き継ぐ -->
				<input type="hidden" name="plan" value={planParam ?? ''} />

				<FormField
					label="メールアドレス"
					type="email"
					id="email"
					name="email"
					bind:value={email}
					placeholder="example@email.com"
					required
					autocomplete="email"
				/>

				<FormField
					label="パスワード"
					type="password"
					id="password"
					name="password"
					bind:value={password}
					placeholder="8文字以上（大小英字・数字を含む）"
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					hint="8文字以上、大文字・小文字・数字を含む"
				/>

				<FormField
					label="パスワード（確認）"
					type="password"
					id="passwordConfirm"
					name="passwordConfirm"
					bind:value={passwordConfirm}
					placeholder="パスワードを再入力"
					required
					minlength={8}
					autocomplete="new-password"
					showToggle
					error={passwordConfirm && password !== passwordConfirm ? 'パスワードが一致しません' : undefined}
					hint={passwordConfirm && password === passwordConfirm ? 'パスワードが一致しました' : undefined}
				/>

				{#if showLicenseKey}
					<FormField
						label="ライセンスキー"
						id="licenseKey"
						hint="購入済みのライセンスキーを入力してください"
						error={licenseKeyError}
					>
						{#snippet children()}
							<input
								id="licenseKey"
								name="licenseKey"
								type="text"
								bind:value={licenseKeyRaw}
								placeholder="GQ-XXXX-XXXX-XXXX-XXXXX"
								required
								autocomplete="off"
								class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] text-sm uppercase font-mono tracking-wider
									focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors"
							/>
						{/snippet}
					</FormField>

					<!-- #799: 折りたたみヘルプ「ライセンスキーについて」 -->
					<div class="-mt-3">
						<button
							type="button"
							class="text-xs text-[var(--color-text-link)] underline hover:no-underline"
							aria-expanded={showLicenseHelp}
							aria-controls="license-key-help"
							onclick={() => { showLicenseHelp = !showLicenseHelp; }}
							data-testid="signup-license-help-toggle"
						>
							{showLicenseHelp ? '▼' : '▶'} ライセンスキーについて
						</button>
						{#if showLicenseHelp}
							<div
								id="license-key-help"
								class="mt-2 p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)] text-xs text-[var(--color-text-muted)] leading-relaxed space-y-1.5"
								data-testid="signup-license-help"
							>
								<p><strong class="text-[var(--color-text-primary)]">一回限りの使用</strong>: 一度有効化すると、他のアカウントでは使用できません。</p>
								<p><strong class="text-[var(--color-text-primary)]">プラン自動判定</strong>: キーに応じてスタンダード / ファミリープランが自動で付与されます。</p>
								<p><strong class="text-[var(--color-text-primary)]">紐付け先</strong>: 現在登録中のアカウント（家族）に紐付きます。後から他の家族に付け替えることはできません。</p>
								<p><strong class="text-[var(--color-text-primary)]">有効期限</strong>: 発行日から所定の期間で失効します（失効後は使用不可）。</p>
							</div>
						{/if}
					</div>

					<!-- #799: 一回限り使用に同意 -->
					<FormField label="" error={submitAttempted && !agreedLicenseOnce ? '一回限り使用への同意が必要です' : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									bind:checked={agreedLicenseOnce}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
									data-testid="signup-license-once-checkbox"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									このライセンスキーが<strong class="text-[var(--color-text-primary)]">一回限り使用</strong>であり、他のアカウントでは使えなくなることに同意します
								</span>
							</label>
						{/snippet}
					</FormField>

					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] underline -mt-3 !p-0"
						onclick={() => { showLicenseKey = false; licenseKeyRaw = ''; agreedLicenseOnce = false; showLicenseHelp = false; }}
					>
						ライセンスキーなしで続ける
					</Button>
				{:else}
					<input type="hidden" name="licenseKey" value="" />
				{/if}

				<div class="-mt-1">
					<FormField label="" error={submitAttempted && !agreedTerms ? '利用規約への同意が必要です' : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 {termsViewed ? 'cursor-pointer' : 'cursor-default'}">
								<input
									type="checkbox"
									name="agreedTerms"
									bind:checked={agreedTerms}
									disabled={!termsViewed}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)] disabled:opacity-40"
									onclick={(e) => {
										if (!termsViewed) {
											e.preventDefault();
											termsHintShown = true;
										}
									}}
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline" onclick={() => { termsViewed = true; termsHintShown = false; }}>利用規約</a>に同意します
									{#if termsHintShown && !termsViewed}
										<span class="block text-xs text-[var(--color-warning)] mt-0.5">先に利用規約をお読みください</span>
									{/if}
								</span>
							</label>
						{/snippet}
					</FormField>
					<FormField label="" error={submitAttempted && !agreedPrivacy ? 'プライバシーポリシーへの同意が必要です' : undefined}>
						{#snippet children()}
							<label class="flex items-start gap-2 {privacyViewed ? 'cursor-pointer' : 'cursor-default'}">
								<input
									type="checkbox"
									name="agreedPrivacy"
									bind:checked={agreedPrivacy}
									disabled={!privacyViewed}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)] disabled:opacity-40"
									onclick={(e) => {
										if (!privacyViewed) {
											e.preventDefault();
											privacyHintShown = true;
										}
									}}
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline" onclick={() => { privacyViewed = true; privacyHintShown = false; }}>プライバシーポリシー</a>に同意します
									{#if privacyHintShown && !privacyViewed}
										<span class="block text-xs text-[var(--color-warning)] mt-0.5">先にプライバシーポリシーをお読みください</span>
									{/if}
								</span>
							</label>
						{/snippet}
					</FormField>
					<p class="text-xs text-[var(--color-neutral-400)] mt-1 ml-6 leading-snug">
						※ 本サービスは子供のデータを扱います。保護者として上記に同意してください。
					</p>
				</div>

				{#if submitAttempted && !canSubmit}
					<p class="text-xs text-[var(--color-danger)] text-center" role="alert">
						{submitBlockReason()}
					</p>
				{/if}

				<Button
					type="submit"
					disabled={!canSubmit}
					size="md"
					class="w-full disabled:opacity-40 disabled:cursor-not-allowed"
					data-testid="signup-submit-button"
					onclick={(e) => {
						if (!canSubmit) {
							e.preventDefault();
							submitAttempted = true;
							return;
						}
						// #799: ライセンスキー使用時は確認ダイアログを経由
						if (showLicenseKey) {
							e.preventDefault();
							showLicenseConfirmDialog = true;
						}
					}}
				>
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						登録中...
					{:else if showLicenseKey}
						ライセンスキーで登録
					{:else if planParam}
						7日間 無料体験をはじめる
					{:else}
						無料ではじめる
					{/if}
				</Button>

				{#if planParam}
					<p class="text-xs text-center text-[var(--color-neutral-400)] -mt-2">
						セットアップ後に {planParam === 'family' ? 'ファミリー' : 'スタンダード'}プランのトライアルが開始されます
					</p>
				{/if}
			</form>

			<!-- ライセンスキー / プランの切り替えリンク -->
			<div class="mt-3 text-center">
				{#if !showLicenseKey}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] underline !p-0"
						onclick={() => { showLicenseKey = true; }}
					>
						ライセンスキーをお持ちの方
					</Button>
				{/if}
			</div>
		{/if}

		<div class="mt-5 text-center">
			<a href="/auth/login" class="text-sm text-[var(--color-text-link)] hover:underline">
				既にアカウントをお持ちの方はこちら
			</a>
		</div>

		<!-- #709: 有料プラン契約に関する法的開示（特商法第11条準拠） -->
		<div class="mt-4 pt-3 border-t border-[var(--color-border-light)] text-center">
			<p class="text-xs text-[var(--color-text-tertiary)] leading-relaxed">
				有料プランをご利用の前に
				<a href="https://www.ganbari-quest.com/tokushoho.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline mx-1">特定商取引法に基づく表記</a>
				および
				<a href="https://www.ganbari-quest.com/sla.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline mx-1">SLA</a>
				をご確認ください
			</p>
		</div>
		{/snippet}
	</Card>
</div>

<!-- #799: ライセンスキー有効化 確認ダイアログ -->
<Dialog
	bind:open={showLicenseConfirmDialog}
	title="ライセンスキーを有効化しますか？"
	size="md"
	testid="signup-license-confirm-dialog"
>
	{#snippet children()}
		<div class="space-y-4 text-sm">
			<div class="p-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] border border-[var(--color-border-default)]">
				<p class="text-xs text-[var(--color-text-tertiary)] mb-1">入力されたキー</p>
				<p class="font-mono text-[var(--color-text-primary)] break-all" data-testid="signup-license-confirm-key">
					{licenseKey}
				</p>
			</div>

			<ul class="space-y-2 text-[var(--color-text-secondary)]">
				<li class="flex gap-2">
					<span aria-hidden="true">⚠️</span>
					<span>このキーは<strong class="text-[var(--color-text-primary)]">一回限り</strong>しか使用できません。有効化後は他のアカウントで再利用できません。</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">📦</span>
					<span>キーに対応する<strong class="text-[var(--color-text-primary)]">プラン（スタンダード / ファミリー）</strong>が自動で付与されます。</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">👤</span>
					<span>このキーは<strong class="text-[var(--color-text-primary)]">「{email || '入力中のアカウント'}」</strong>に紐付けられ、後から他の家族に付け替えることはできません。</span>
				</li>
				<li class="flex gap-2">
					<span aria-hidden="true">⏳</span>
					<span>キーには<strong class="text-[var(--color-text-primary)]">有効期限</strong>が設定されています。発行から一定期間で失効します。</span>
				</li>
			</ul>

			<div class="flex gap-2 pt-2">
				<Button
					type="button"
					variant="secondary"
					size="md"
					class="flex-1"
					data-testid="signup-license-confirm-cancel"
					onclick={() => { showLicenseConfirmDialog = false; }}
				>
					キャンセル
				</Button>
				<Button
					type="button"
					variant="primary"
					size="md"
					class="flex-1"
					data-testid="signup-license-confirm-ok"
					onclick={() => {
						showLicenseConfirmDialog = false;
						signupFormEl?.requestSubmit();
					}}
				>
					有効化する
				</Button>
			</div>
		</div>
	{/snippet}
</Dialog>
