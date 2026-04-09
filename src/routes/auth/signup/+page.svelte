<script lang="ts">
import { onDestroy } from 'svelte';
import { enhance } from '$app/forms';
import { page } from '$app/stores';
import { SIGNUP_CODE_EXPIRY_MINUTES } from '$lib/domain/validation/auth';
import GoogleSignInButton from '$lib/ui/components/GoogleSignInButton.svelte';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
import Divider from '$lib/ui/primitives/Divider.svelte';
import FormField from '$lib/ui/primitives/FormField.svelte';

let { form } = $props();

let email = $state('');
let password = $state('');
let passwordConfirm = $state('');
let licenseKey = $state('');
let codeRaw = $state('');
const code = $derived(codeRaw.replace(/\s/g, ''));
let loading = $state(false);
let resending = $state(false);
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);
let showLicenseKey = $state(false);

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
		licenseKey = form.licenseKey;
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
			<div class="mb-4 p-3 bg-red-50 text-red-600 border border-red-200 rounded-[var(--radius-sm)] text-sm" role="alert">
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
				<div class="mt-3 p-3 bg-green-50 text-green-600 border border-green-200 rounded-[var(--radius-sm)] text-sm text-center" role="status">
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
					<FormField label="ライセンスキー" id="licenseKey" hint="購入済みのライセンスキーを入力してください">
						{#snippet children()}
							<input
								id="licenseKey"
								name="licenseKey"
								type="text"
								bind:value={licenseKey}
								placeholder="GQ-XXXX-XXXX-XXXX-XXXXX"
								autocomplete="off"
								class="w-full px-3 py-2 border border-[var(--input-border)] rounded-[var(--input-radius)] text-sm uppercase font-mono tracking-wider
									focus:border-[var(--input-border-focus)] focus:outline-none focus:ring-2 focus:ring-opacity-30 transition-colors"
							/>
						{/snippet}
					</FormField>
				{:else}
					<input type="hidden" name="licenseKey" value="" />
				{/if}

				<div class="-mt-1">
					<FormField label="">
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									name="agreedTerms"
									bind:checked={agreedTerms}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/terms.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline">利用規約</a>に同意します
								</span>
							</label>
						{/snippet}
					</FormField>
					<FormField label="">
						{#snippet children()}
							<label class="flex items-start gap-2 cursor-pointer">
								<input
									type="checkbox"
									name="agreedPrivacy"
									bind:checked={agreedPrivacy}
									class="mt-0.5 w-4 h-4 shrink-0 accent-[var(--theme-primary)]"
								/>
								<span class="text-[0.8rem] text-[var(--color-text-muted)] leading-relaxed">
									<a href="https://www.ganbari-quest.com/privacy.html" target="_blank" rel="noopener" class="text-[var(--color-text-link)] underline">プライバシーポリシー</a>に同意します
								</span>
							</label>
						{/snippet}
					</FormField>
					<p class="text-xs text-[var(--color-neutral-400)] mt-1 ml-6 leading-snug">
						※ 本サービスは子供のデータを扱います。保護者として上記に同意してください。
					</p>
				</div>

				<Button
					type="submit"
					disabled={loading || !email || !password || !passwordConfirm || !agreedTerms || !agreedPrivacy}
					size="md"
					class="w-full"
				>
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						登録中...
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
					<button
						type="button"
						class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-link)] underline cursor-pointer bg-transparent border-none p-0"
						onclick={() => { showLicenseKey = true; }}
					>
						ライセンスキーをお持ちの方
					</button>
				{/if}
			</div>
		{/if}

		<div class="mt-5 text-center">
			<a href="/auth/login" class="text-sm text-[var(--color-text-link)] hover:underline">
				既にアカウントをお持ちの方はこちら
			</a>
		</div>
		{/snippet}
	</Card>
</div>
