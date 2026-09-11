<script lang="ts">
// src/lib/ui/components/SetupNoScriptNotice.svelte
//
// セットアップの選択画面 (パック / ごほうび / ルール) を JavaScript 無しで開いたときの案内
// (PO 決裁 2026-09-10 決定 7)。
//
// これらの画面は取り込む対象を `<button type="button">` + client state で選ばせるため、
// JavaScript が無効だと選択そのものが成立しない。**no-JS での前進は支えないと決めた**ので、
// 動かない画面を黙って見せるのをやめ、何が必要かと次の一手だけを伝える。
//
// 3 画面で同じ文言を出すので component 1 本にする (同じ文を 3 箇所に写さない)。

import { SETUP_NOSCRIPT_LABELS } from '$lib/domain/labels';
</script>

<noscript>
	<div
		class="mb-4 rounded-[var(--radius-lg)] border border-[var(--color-feedback-warning-border)] bg-[var(--color-feedback-warning-bg)] p-4"
		data-testid="setup-noscript-notice"
	>
		<p class="m-0 font-bold text-[var(--color-feedback-warning-text)]">
			{SETUP_NOSCRIPT_LABELS.title}
		</p>
		<p class="mt-2 mb-0 text-sm text-[var(--color-text-primary)]">
			{SETUP_NOSCRIPT_LABELS.body}
		</p>
		<p class="mt-2 mb-0 text-xs text-[var(--color-text-muted)]">
			{SETUP_NOSCRIPT_LABELS.fallback}
		</p>
	</div>
</noscript>
