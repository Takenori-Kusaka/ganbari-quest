<script lang="ts">
/**
 * /admin/license — ライセンス管理ページ薄ラッパー (EPIC #2327 / #2331)
 *
 * runtimeMode (ADR-0040 SSOT、hooks.server.ts 注入) で 2 分岐:
 *   - 'nuc-prod' → NucLicensePanel (Edition badge + 簡略 3 セクション、Mattermost 整合)
 *   - その他     → SaasLicensePanel (AWS 用 7 セクション、表示矛盾解消 + placeholder 削除)
 *
 * 旧実装 940 行 → 25 行 (97% 削減)、Panel 内訳 80 + 580 ≒ 660 行 (元 940 比 30% 削減)。
 */
import NucLicensePanel from '$lib/features/admin/components/NucLicensePanel.svelte';
import SaasLicensePanel from '$lib/features/admin/components/SaasLicensePanel.svelte';

let { data, form } = $props();
</script>

{#if data.runtimeMode === 'nuc-prod'}
	<NucLicensePanel {data} />
{:else}
	<SaasLicensePanel {data} {form} />
{/if}
