<script lang="ts">
/**
 * 生成 AI に送信される入力欄に添える注意書き (#4599)。
 *
 * AI 提案 3 種 (活動 / チェックリスト / ごほうび) と領収書 OCR の 4 経路で共有する。
 * 文言は `AI_INPUT_NOTICE_LABELS` (labels.ts SSOT) の 1 箇所定義を参照し、経路ごとに
 * コピペしない。ADR-0012 整合で hint 1 行に留め、Dialog / confirm を足さない。
 */
import { AI_INPUT_NOTICE_LABELS } from '$lib/domain/labels';

interface Props {
	/** text = 入力文が送られる経路 / image = 画像が送られる経路 */
	variant?: 'text' | 'image';
	testid?: string;
}

let { variant = 'text', testid = 'ai-input-notice' }: Props = $props();

const message = $derived(
	variant === 'image' ? AI_INPUT_NOTICE_LABELS.image : AI_INPUT_NOTICE_LABELS.text,
);
</script>

<p
	class="text-xs text-[var(--color-text-muted)]"
	data-testid={testid}
	data-ai-notice-variant={variant}
>
	{message}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 外部 LP の privacy.html 固定 URL を labels.ts SSOT (linkHref) 経由で参照するため resolve() の対象外 -->
	<a href={AI_INPUT_NOTICE_LABELS.linkHref} target="_blank" rel="noopener noreferrer" class="underline text-[var(--color-text-link)]">
		{AI_INPUT_NOTICE_LABELS.linkLabel}
	</a>
</p>
