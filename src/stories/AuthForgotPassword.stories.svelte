<script module>
// #4702: パスワード再設定画面の dead-end 2 件 (再送ボタン無し / Google 登録ユーザ向け案内無し) の
// 視認用 story。/auth/forgot-password は dev / local モードで /auth/login に redirect される
// (本番 Cognito 専用) ため実サーバでは描画できない。action が返す form をそのまま渡す。
import { defineMeta } from '@storybook/addon-svelte-csf';
import ForgotPasswordPage from '../routes/auth/forgot-password/+page.svelte';

const { Story } = defineMeta({
	title: 'Pages/AuthForgotPassword',
	component: ForgotPasswordPage,
	parameters: { layout: 'fullscreen' },
});
</script>

<!-- Step 1: メール入力。Google 登録ユーザ向け案内が常時出る -->
<Story name="Step1EmailInput" args={{ form: null }} />

<!-- Step 2: 確認コード + 新パスワード。「コードを再送する」が出る (旧実装は文言だけで操作が無かった) -->
<Story name="Step2ConfirmCode" args={{ form: { confirmStep: true, email: 'parent@example.com' } }} />

<!-- Step 2 で再送した直後: 「確認コードを再送しました」+ cooldown 表示 -->
<Story
	name="Step2AfterResend"
	args={{ form: { confirmStep: true, email: 'parent@example.com', resent: true } }}
/>

<!-- エラー時 (コード誤り等) でも Google 案内と再送導線が残る -->
<Story
	name="Step2WithError"
	args={{
		form: {
			confirmStep: true,
			email: 'parent@example.com',
			error: '確認コードが正しくありません',
		},
	}}
/>
