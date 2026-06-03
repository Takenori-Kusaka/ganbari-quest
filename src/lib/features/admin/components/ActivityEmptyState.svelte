<script lang="ts">
/**
 * ActivityEmptyState — admin/activities 専用 empty state。
 *
 * CX-DoR #9・#11 横展開 (Round 18): 旧来の独自 markup を撤去し、共通 SSOT
 * `UnifiedEmptyState.svelte` (#2362) に委譲する thin wrapper に統一した
 * (NN/G #4 consistency / DoR #11 3 状態統一)。文言・testid・visibility matrix は
 * 従来契約 (FEATURES_LABELS.activityEmptyState / `empty-state-import-link` /
 * onAdd('browse')) を完全維持し視覚回帰ゼロ。
 */
import { FEATURES_LABELS } from '$lib/domain/labels';
import UnifiedEmptyState from '$lib/marketplace/ui/UnifiedEmptyState.svelte';

// #2558 段階2: secondary link は admin 内ブラウズ UI でなく /marketplace への遷移 (`browse`)
type AddMode = 'manual' | 'browse';

interface Props {
	hasFilter: boolean;
	canAdd: boolean;
	onAdd: (mode: AddMode) => void;
}

let { hasFilter, canAdd, onAdd }: Props = $props();

const L = FEATURES_LABELS.activityEmptyState;
</script>

<UnifiedEmptyState
	{hasFilter}
	{canAdd}
	icon="📋"
	noItemsText={L.noActivities}
	filteredText={L.filteredText}
	addBtnLabel={L.addBtn}
	importLinkLabel={L.secondaryImportLink}
	importTestid="empty-state-import-link"
	onAdd={(mode) => onAdd(mode === 'import' ? 'browse' : 'manual')}
/>
