<script lang="ts">
import { resolve } from '$app/paths';
import { ADMIN_CHILD_SCOPE_LABELS } from '$lib/domain/labels';
import Alert from '$lib/ui/primitives/Alert.svelte';
import Button from '$lib/ui/primitives/Button.svelte';

/**
 * #4692 F6: お子さま 0 人で marketplace 取込 URL (`?import=<presetId>`) を開いたときの案内。
 *
 * 旧実装は 3 admin 画面 (活動 / ごほうび / チェックリスト) が children 0 件でも
 * ChildSelectionDialog を auto-open していたため、選択肢が 1 つも無い dialog が開き、
 * 確定すると「すでに追加済み」(活動) / 無反応 (ごほうび) / 配信先 0 のテンプレ作成
 * (チェックリスト) という別々の壊れ方をしていた。marketplace 詳細が 0 人のときに
 * `/setup/children` へ分岐するのと同じ扱いに 3 画面を揃える。
 */
interface Props {
	/** 任意の testid (画面ごとの E2E 用) */
	testid?: string;
}

let { testid = 'import-needs-child-notice' }: Props = $props();
</script>

<Alert variant="warning" data-testid={testid}>
	<p class="notice-title">{ADMIN_CHILD_SCOPE_LABELS.noChildrenTitle}</p>
	<p class="notice-desc">{ADMIN_CHILD_SCOPE_LABELS.noChildrenDesc}</p>
	<Button
		variant="primary"
		size="sm"
		href={resolve('/setup/children')}
		data-testid="{testid}-cta"
	>
		{ADMIN_CHILD_SCOPE_LABELS.noChildrenCta}
	</Button>
</Alert>

<style>
	.notice-title {
		font-weight: 700;
	}
	.notice-desc {
		margin-block: 0.25rem 0.5rem;
	}
</style>
