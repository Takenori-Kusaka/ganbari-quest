<script lang="ts">
import type { UiMode } from '$lib/domain/validation/age-tier';
import { getHabitCertificateNoticeText } from '$lib/features/child-home/habit-certificate-notice';
import Alert from '$lib/ui/primitives/Alert.svelte';

/**
 * #4261 ③: 月間の習慣化で増えた残高の理由を、子に**次回起動で 1 回だけ**静かに伝える。
 *
 * ADR-0012 との両立条件 (PO 決裁 2026-08-06) をこの component の形で守る:
 * **閉じるボタンを持たない** (子に閉じる操作をさせない) / **アニメーションを持たない**
 * (紙吹雪・音・連続ダイアログを足さない) / 次の行動を促す CTA を置かない。
 * 既読化は「表示できた」時点で呼び出し側が 1 回だけ行う。
 */
interface Props {
	/** 表示するか (判定は `habit-certificate-notice.ts` の純関数が持つ) */
	visible: boolean;
	/** baby は子供向けホームを持たない (ADR-0011) */
	uiMode: Exclude<UiMode, 'baby'>;
	/** pointSettings に沿って整形済みの受取量 (例: `50ポイント`) */
	amount: string;
}

let { visible, uiMode, amount }: Props = $props();

const text = $derived(getHabitCertificateNoticeText(uiMode, amount));
</script>

{#if visible}
	<div class="mt-2" data-testid="habit-certificate-notice">
		<Alert variant="success">
			<p class="font-bold">{text.title}</p>
			<p class="opacity-80">{text.body}</p>
		</Alert>
	</div>
{/if}
