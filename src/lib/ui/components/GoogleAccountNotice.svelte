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
import { resolve } from '$app/paths';
import { FORGOT_PASSWORD_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';

interface Props {
	class?: string;
}

let { class: className = '' }: Props = $props();

// svelte/no-navigation-without-resolve: base path 付きデプロイでも壊れないよう resolve() 経由にする
const loginHref = resolve('/auth/login');
</script>

<Alert variant="info" class={className} data-testid="forgot-password-google-notice">
	<span>{FORGOT_PASSWORD_LABELS.googleUserNotice}</span>
	<a href={loginHref} class="text-[var(--color-text-link)] hover:underline whitespace-nowrap">
		{FORGOT_PASSWORD_LABELS.googleUserNoticeLink}
	</a>
</Alert>
