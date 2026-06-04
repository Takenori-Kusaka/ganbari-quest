<script lang="ts">
/**
 * /admin/subscription — サブスクリプション管理ページ薄ラッパー (EPIC #2327 / #2331)
 *
 * Epic #2525 Phase 7 PR-L3 (#2818): 旧 /admin/license から rename。
 *
 * runtimeMode (ADR-0040 SSOT、hooks.server.ts 注入) で 2 分岐:
 *   - 'nuc-prod' → NucLicensePanel (Edition badge + 簡略 3 セクション、Mattermost 整合)
 *   - その他     → SaasLicensePanel (subscription 管理、license key UI は PR-L3 で撤去済)
 */
import NucLicensePanel from '$lib/features/admin/components/NucLicensePanel.svelte';
import SaasLicensePanel from '$lib/features/admin/components/SaasLicensePanel.svelte';

let { data } = $props();
</script>

{#if data.runtimeMode === 'nuc-prod'}
	<NucLicensePanel {data} />
{:else}
	<SaasLicensePanel {data} />
{/if}
