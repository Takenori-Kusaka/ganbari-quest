<script lang="ts">
/**
 * 復元 / クラウド取込がプラン上限で一部を **保管 (archived)** したときの結果行 (#4693)。
 *
 * PO 回答 (2026-09-03) #2: 上限を超える復元で顧客のデータを落とさない。超過分は取り込んだうえで
 * archived にし、結果には「入った数 / 入らなかった数 / 理由 / 次の行動」を必ず出す。
 * 「復元しました」だけで黙って落とすのは不可。
 *
 * 直接復元 (`api/v1/import`) とクラウド取込 (`api/v1/import/cloud`) の 2 経路が同じ文言 / 同じ
 * 導線を出すよう component に切り出す (2 箇所に同じ markup を書くと片方だけ直る)。
 */
import { resolve } from '$app/paths';
import { PLAN_UPGRADE_URL } from '$lib/domain/errors';
import { PLAN_GATE_LABELS, SETTINGS_LABELS } from '$lib/domain/labels';

interface Props {
	/** 復元対象だったオリジナル活動の行数 (= activated + archived) */
	total: number;
	/** 有効な状態で入った行数 */
	activated: number;
	/** プランの上限のため保管した行数。0 なら何も描画しない */
	archived: number;
	/** 顧客に見せる理由 (server の quota.message) */
	message: string;
	/** プラン上限が理由のときのアップグレード導線 (それ以外は null) */
	upgradeUrl: string | null;
	/** E2E / story 用 testid (経路ごとに変える) */
	testid: string;
}

let { total, activated, archived, message, upgradeUrl, testid }: Props = $props();
</script>

{#if archived > 0}
	<li class="quota-archived" data-testid={testid}>
		{SETTINGS_LABELS.dataImportResultQuotaArchived(total, activated, archived)}{message
			? ` — ${message}`
			: ''}
		{#if upgradeUrl}
			<a class="quota-archived__link" href={resolve(PLAN_UPGRADE_URL)}
				>{PLAN_GATE_LABELS.upgradeLinkLabel}</a
			>
		{/if}
	</li>
{/if}

<style>
	.quota-archived {
		color: var(--color-feedback-warning-text);
	}
	.quota-archived__link {
		margin-left: 0.25rem;
		text-decoration: underline;
	}
</style>
