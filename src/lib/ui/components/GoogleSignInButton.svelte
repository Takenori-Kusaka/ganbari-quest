<script lang="ts">
/**
 * Google Sign-In ボタン — Google ブランドガイドライン準拠
 * @see https://developers.google.com/identity/branding-guidelines
 *
 * - 白背景 + Google 公式カラーロゴ + "Sign in with Google" テキスト
 * - フォント: Roboto 500 (medium)
 * - 最小サイズ・パディング・角丸はガイドライン準拠
 */

interface Props {
	/** ボタンテキスト（デフォルト: "Google でログイン"） */
	label?: string;
	/** リンク先 URL */
	href?: string;
	/** 追加CSSクラス */
	class?: string;
}

let {
	label = 'Google でログイン',
	href = '/auth/oauth/google',
	class: className = '',
}: Props = $props();
</script>

<a
	{href}
	class="google-signin-btn {className}"
	role="button"
>
	<svg class="google-signin-icon" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
		<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
		<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
		<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
	</svg>
	<span class="google-signin-text">{label}</span>
</a>

<style>
	.google-signin-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		width: 100%;
		height: 44px;
		padding: 0 16px;
		background-color: #fff;
		border: 1px solid var(--color-border-default, #dadce0);
		border-radius: var(--radius-sm, 6px);
		cursor: pointer;
		transition: background-color 0.2s, box-shadow 0.2s;
		text-decoration: none;
	}

	.google-signin-btn:hover {
		background-color: #f7f8f8;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.google-signin-btn:active {
		background-color: #eee;
	}

	.google-signin-icon {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.google-signin-text {
		font-family: 'Roboto', sans-serif;
		font-weight: 500;
		font-size: 14px;
		color: #3c4043;
		letter-spacing: 0.25px;
	}
</style>
