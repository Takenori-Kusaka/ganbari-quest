<script lang="ts">
/**
 * Google (federated) 登録ユーザー向けの案内 (#4702)。
 *
 * Google で登録した顧客は Cognito にパスワードを持たないため、パスワード再設定の
 * 確認コードは永久に届かない。Cognito は「アカウントが存在しない」ことを伏せる仕様
 * (ForgotPassword の UserNotFoundException を成功扱い) で、画面は「送信しました」の
 * まま待たせ続けてしまう。よって **全員に常時** 出す案内としてここに切り出す
 * (特定アカウントの存在を漏らさずに dead-end を解消する)。
 */
import { FORGOT_PASSWORD_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';

interface Props {
	/** ログイン画面へのリンク先 (既定: /auth/login) */
	loginHref?: string;
	class?: string;
}

let { loginHref = '/auth/login', class: className = '' }: Props = $props();
</script>

<Alert variant="info" class={className} data-testid="forgot-password-google-notice">
	{#snippet children()}
		<span>{FORGOT_PASSWORD_LABELS.googleUserNotice}</span>
		<a href={loginHref} class="text-[var(--color-text-link)] hover:underline whitespace-nowrap">
			{FORGOT_PASSWORD_LABELS.googleUserNoticeLink}
		</a>
	{/snippet}
</Alert>
