<script lang="ts">
import { ARCHIVED_RESOURCE_LABELS, getAgeTierLabel } from '$lib/domain/labels';
import Button from '$lib/ui/primitives/Button.svelte';
import Card from '$lib/ui/primitives/Card.svelte';

// #4708: 無料プランの上限で archive (一時非表示) 中のお子さまの読み取り専用一覧。
// /admin/children の一覧の下に anchor `#archived` で置く。FAQ「管理画面で確認できる」の実体。
// 復元操作は置かない (有料化で自動復元、webhook W1 / W2 / W4)。編集 / 削除 / 詳細リンクも置かない。
interface Props {
	children: Array<{
		id: string;
		nickname: string;
		age: number;
		uiMode: string;
		avatarUrl?: string | null;
	}>;
	basePath?: string;
}

let { children, basePath = '/admin' }: Props = $props();
</script>

{#if children.length > 0}
	<section class="archived-children" id="archived" data-testid="archived-children-section">
		<Card>
			<h3 class="archived-children__title">
				📦 {ARCHIVED_RESOURCE_LABELS.childrenSectionTitle}（{children.length}）
			</h3>
			<p class="archived-children__desc">{ARCHIVED_RESOURCE_LABELS.childrenSectionDesc}</p>
			<ul class="archived-children__list">
				{#each children as child (child.id)}
					<li class="archived-children__item" data-testid="archived-child-item">
						<span class="archived-children__name">{child.nickname}</span>
						<span class="archived-children__meta">
							{getAgeTierLabel(child.uiMode)}
						</span>
						<span class="archived-children__tag">
							{ARCHIVED_RESOURCE_LABELS.childrenSectionReadOnlyTag}
						</span>
					</li>
				{/each}
			</ul>
			<div class="archived-children__cta">
				<Button
					variant="primary"
					size="sm"
					href="{basePath}/subscription"
					data-testid="archived-children-cta"
				>
					{ARCHIVED_RESOURCE_LABELS.childrenSectionCta}
				</Button>
			</div>
		</Card>
	</section>
{/if}

<style>
	.archived-children__title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--color-text-primary);
		margin: 0 0 4px;
	}

	.archived-children__desc {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		margin: 0 0 12px;
	}

	.archived-children__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.archived-children__item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--color-surface-muted);
		opacity: 0.7;
	}

	.archived-children__name {
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.archived-children__meta {
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		flex: 1;
	}

	.archived-children__tag {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border-default);
		border-radius: 999px;
		padding: 2px 8px;
	}

	.archived-children__cta {
		margin-top: 12px;
		display: flex;
		justify-content: flex-end;
	}
</style>
