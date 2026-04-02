<script lang="ts">
import { enhance } from '$app/forms';
import Logo from '$lib/ui/components/Logo.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

let { form } = $props();

let email = $state('');
let password = $state('');
let passwordConfirm = $state('');
let licenseKey = $state('');
let codeRaw = $state('');
const code = $derived(codeRaw.replace(/\s/g, ''));
let loading = $state(false);
let agreedTerms = $state(false);
let agreedPrivacy = $state(false);

let confirmStep = $derived(form?.confirmStep ?? false);

// サーバーレスポンス（form）からフォーム値を復元
$effect(() => {
	if (typeof form?.email === 'string') email = form.email;
	if (typeof form?.licenseKey === 'string') licenseKey = form.licenseKey;
});
</script>

<svelte:head>
	<title>アカウント登録 - がんばりクエスト</title>
</svelte:head>

<div class="min-h-dvh flex items-center justify-center bg-[var(--gradient-brand)] p-4">
	<div class="w-full max-w-[400px] bg-[var(--color-surface-card)] rounded-[var(--radius-md)] px-8 py-10 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
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

				<div class="flex flex-col gap-1.5">
					<label for="code" class="text-sm font-semibold text-[var(--color-text)]">確認コード</label>
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
				</div>

				<Button type="submit" disabled={loading || code.length < 1} size="md" class="w-full">
					{#if loading}
						<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" aria-hidden="true"></span>
						確認中...
					{:else}
						確認する
					{/if}
				</Button>
			</form>
		{:else}
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
				<div class="flex flex-col gap-1.5">
					<label for="email" class="text-sm font-semibold text-[var(--color-text)]">メールアドレス</label>
					<input
						id="email"
						name="email"
						type="email"
						bind:value={email}
						placeholder="example@email.com"
						required
						autocomplete="email"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="password" class="text-sm font-semibold text-[var(--color-text)]">パスワード</label>
					<input
						id="password"
						name="password"
						type="password"
						bind:value={password}
						placeholder="8文字以上（大小英字・数字を含む）"
						required
						minlength="8"
						autocomplete="new-password"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
					<span class="text-xs text-[var(--color-text-muted)]">8文字以上、大文字・小文字・数字を含む</span>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="passwordConfirm" class="text-sm font-semibold text-[var(--color-text)]">パスワード（確認）</label>
					<input
						id="passwordConfirm"
						name="passwordConfirm"
						type="password"
						bind:value={passwordConfirm}
						placeholder="パスワードを再入力"
						required
						minlength="8"
						autocomplete="new-password"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="licenseKey" class="text-sm font-semibold text-[var(--color-text)]">
						ライセンスキー <span class="font-normal text-xs text-[var(--color-text-muted)]">（任意）</span>
					</label>
					<input
						id="licenseKey"
						name="licenseKey"
						type="text"
						bind:value={licenseKey}
						placeholder="GQ-XXXX-XXXX-XXXX"
						autocomplete="off"
						class="px-4 py-3 border border-[var(--input-border)] rounded-[var(--input-radius)] text-base uppercase font-mono tracking-wider
							focus:border-[var(--input-border-focus)] focus:ring-2 focus:ring-[var(--color-brand-300)] focus:ring-opacity-50 outline-none transition-colors"
					/>
					<span class="text-xs text-[var(--color-text-muted)]">購入済みの方はライセンスキーを入力するとプレミアムプランが有効になります</span>
				</div>

				<div class="-mt-1">
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
					{:else}
						アカウントを作成
					{/if}
				</Button>
			</form>
		{/if}

		<div class="mt-5 text-center">
			<a href="/auth/login" class="text-sm text-[var(--color-text-link)] hover:underline">
				既にアカウントをお持ちの方はこちら
			</a>
		</div>
	</div>
</div>
