<script lang="ts">
import Card from '$lib/ui/primitives/Card.svelte';

interface CertificateItem {
	id: number;
	certificateType: string;
	title: string;
	description: string | null;
	issuedAt: string;
	icon: string;
	category: string;
}

interface Props {
	certificate: CertificateItem;
	basePath?: string;
}

let { certificate, basePath = '/admin/certificates' }: Props = $props();

const formattedDate = $derived(
	new Date(certificate.issuedAt).toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	}),
);

const categoryLabel = $derived(
	{
		streak: 'れんぞく',
		monthly: 'がつかん',
		level: 'レベル',
		category_master: 'マスター',
		annual: 'ねんかん',
	}[certificate.category] ?? '',
);
</script>

<a href="{basePath}/{certificate.id}" class="cert-card-link">
	<Card variant="default" padding="md">
		{#snippet children()}
		<div class="cert-card">
			<div class="cert-card-icon">{certificate.icon}</div>
			<div class="cert-card-body">
				<p class="cert-card-title">{certificate.title}</p>
				{#if certificate.description}
					<p class="cert-card-desc">{certificate.description}</p>
				{/if}
				<div class="cert-card-meta">
					<span class="cert-card-badge">{categoryLabel}</span>
					<span class="cert-card-date">{formattedDate}</span>
				</div>
			</div>
			<div class="cert-card-arrow" aria-hidden="true">&rsaquo;</div>
		</div>
		{/snippet}
	</Card>
</a>

<style>
	.cert-card-link {
		display: block;
		text-decoration: none;
		color: inherit;
		transition: transform 0.1s ease;
	}
	.cert-card-link:hover {
		transform: translateY(-1px);
	}
	.cert-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.cert-card-icon {
		font-size: 2rem;
		flex-shrink: 0;
		width: 3rem;
		text-align: center;
	}
	.cert-card-body {
		flex: 1;
		min-width: 0;
	}
	.cert-card-title {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cert-card-desc {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #4b5563);
		margin: 2px 0 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cert-card-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 4px;
	}
	.cert-card-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-brand-100, #dbeafe);
		color: var(--color-brand-700, #1d4ed8);
	}
	.cert-card-date {
		font-size: 0.625rem;
		color: var(--color-text-tertiary, #9ca3af);
	}
	.cert-card-arrow {
		font-size: 1.5rem;
		color: var(--color-text-tertiary, #9ca3af);
		flex-shrink: 0;
	}
</style>
