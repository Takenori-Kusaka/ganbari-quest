<script lang="ts">
/**
 * `/ops` が MFA 未設定で拒否されたときの復旧導線 (運営者専用、#4282 AC5)。
 *
 * **現在は表示されない**: #4363 (オーナー決裁 2026-08-06) で /ops の MFA 要求を撤去したため、
 * 拒否理由 `ops-mfa-required` が発生しない。`capabilities.ts` の `OPS_MFA_REQUIRED` を `true` に
 * 戻すと拒否・導線が同時に復活する (戻すのに再実装を要さないよう本 component を残している)。
 *
 * `/ops` は #4266 で「Cognito ops group + MFA 済セッション」に絞られた (CloudFront の
 * IP allowlist を廃止した代替)。ただし拒否側は共通 403 画面のままで、TOTP 未設定の
 * 運営者は「ログインし直す」を押しても同じ 403 に戻るだけだった。
 *
 * 403 (= データを一切 load しない fail-closed) は維持したまま、**MFA が理由の 403 の
 * ときだけ**この画面を出す。DESIGN.md §5 Dialog「閉じさせない modal には出口を用意する」
 * と同じ規律 — 締め出したなら、そこから戻る道を必ず示す。
 */
import { OPS_MFA_SETUP_LABELS } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';
</script>

<div class="ops-mfa-notice" data-testid="ops-mfa-setup-notice">
	<Card>
		<h1 class="notice-title">{OPS_MFA_SETUP_LABELS.title}</h1>
		<p class="notice-desc">{OPS_MFA_SETUP_LABELS.description}</p>

		<h2 class="steps-title">{OPS_MFA_SETUP_LABELS.stepsTitle}</h2>
		<ol class="steps">
			{#each OPS_MFA_SETUP_LABELS.steps as step (step)}
				<li>{step}</li>
			{/each}
		</ol>

		<div class="actions">
			<Button href="/auth/login" variant="primary">{OPS_MFA_SETUP_LABELS.loginAgainLabel}</Button>
		</div>

		<p class="runbook-hint">{OPS_MFA_SETUP_LABELS.runbookHint}</p>
	</Card>
</div>

<style>
	.ops-mfa-notice {
		max-width: 40rem;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	.notice-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 0.75rem;
	}
	.notice-desc {
		color: var(--color-text-muted);
		line-height: 1.7;
		margin: 0 0 1.5rem;
	}
	.steps-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text);
		margin: 0 0 0.5rem;
	}
	.steps {
		margin: 0 0 1.5rem;
		padding-left: 1.25rem;
		color: var(--color-text);
		line-height: 1.8;
		list-style: decimal;
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.runbook-hint {
		font-size: 0.875rem;
		color: var(--color-text-muted);
		line-height: 1.6;
		margin: 0;
	}
</style>
