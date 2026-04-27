<script lang="ts">
import { FEATURES_LABELS } from '$lib/domain/labels';

// Print-friendly certificate template for browser Print-to-PDF
interface CertificateData {
	id: number;
	childName: string;
	title: string;
	description: string;
	icon: string;
	issuedAt: string;
	stats: { label: string; value: string }[];
}

interface Props {
	certificate: CertificateData;
	watermark?: boolean;
}

let { certificate, watermark = false }: Props = $props();

const formattedDate = $derived(
	new Date(certificate.issuedAt).toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	}),
);
</script>

<div class="cert-page" class:cert-watermark={watermark}>
	<div class="cert-frame">
		<div class="cert-border">
			<!-- Header ornament -->
			<div class="cert-ornament-top">✦ ✦ ✦</div>

			<!-- Title -->
			<h1 class="cert-title">{FEATURES_LABELS.certificate.title}</h1>

			<!-- Icon -->
			<div class="cert-icon">{certificate.icon}</div>

			<!-- Child name -->
			<p class="cert-child-name">{certificate.childName}</p>

			<!-- Certificate title -->
			<h2 class="cert-achievement">{FEATURES_LABELS.certificate.quote(certificate.title)}</h2>

			<!-- Description -->
			<p class="cert-description">{certificate.description}</p>

			<!-- Stats -->
			{#if certificate.stats.length > 0}
				<div class="cert-stats">
					{#each certificate.stats as stat}
						<div class="cert-stat-item">
							<span class="cert-stat-label">{stat.label}</span>
							<span class="cert-stat-value">{stat.value}</span>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Date & Signature -->
			<div class="cert-footer">
				<p class="cert-date">{formattedDate}</p>
				<p class="cert-issuer">{FEATURES_LABELS.certificate.issuer}</p>
				<div class="cert-seal">🎖️</div>
			</div>

			<!-- Bottom ornament -->
			<div class="cert-ornament-bottom">✦ ✦ ✦</div>
		</div>
	</div>

	{#if watermark}
		<div class="cert-watermark-text">{FEATURES_LABELS.certificate.watermarkText}</div>
	{/if}
</div>

<style>
	.cert-page {
		position: relative;
		width: 210mm;
		min-height: 297mm;
		margin: 0 auto;
		padding: 12mm;
		background: white;
		box-sizing: border-box;
	}

	.cert-frame {
		height: 100%;
		padding: 8mm;
		border: 3px solid var(--color-brand-400, #60a5fa);
		border-radius: 4px;
	}

	.cert-border {
		height: 100%;
		padding: 10mm 8mm;
		border: 1px solid var(--color-brand-300, #93bbfd);
		border-radius: 2px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6mm;
		text-align: center;
	}

	.cert-ornament-top,
	.cert-ornament-bottom {
		font-size: 1rem;
		letter-spacing: 1em;
		color: var(--color-brand-400, #60a5fa);
	}

	.cert-title {
		font-size: 2rem;
		font-weight: 800;
		color: var(--color-brand-700, #1d4ed8);
		margin: 0;
		letter-spacing: 0.15em;
	}

	.cert-icon {
		font-size: 4rem;
		line-height: 1;
	}

	.cert-child-name {
		font-size: 1.75rem;
		font-weight: 700;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}

	.cert-achievement {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--color-brand-600, #2563eb);
		margin: 0;
	}

	.cert-description {
		font-size: 1.125rem;
		color: var(--color-text-secondary, #4b5563);
		margin: 0;
		line-height: 1.6;
	}

	.cert-stats {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4mm;
		padding: 4mm 0;
	}

	.cert-stat-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 2mm 4mm;
		border: 1px solid var(--color-brand-200, #bfdbfe);
		border-radius: 8px;
		background: var(--color-brand-50, #eff6ff);
		min-width: 20mm;
	}

	.cert-stat-label {
		font-size: 0.75rem;
		color: var(--color-text-tertiary, #6b7280);
	}

	.cert-stat-value {
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-brand-600, #2563eb);
	}

	.cert-footer {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2mm;
		margin-top: 4mm;
	}

	.cert-date {
		font-size: 1rem;
		color: var(--color-text-secondary, #4b5563);
		margin: 0;
	}

	.cert-issuer {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary, #1f2937);
		margin: 0;
	}

	.cert-seal {
		font-size: 2.5rem;
		line-height: 1;
	}

	/* Watermark overlay for free plan */
	.cert-watermark {
		overflow: hidden;
	}

	.cert-watermark-text {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%) rotate(-30deg);
		font-size: 6rem;
		font-weight: 900;
		color: rgba(0, 0, 0, 0.06);
		pointer-events: none;
		user-select: none;
		letter-spacing: 0.3em;
		white-space: nowrap;
	}

	/* Print styles */
	@media print {
		.cert-page {
			padding: 10mm;
			box-shadow: none;
			page-break-after: always;
		}

		.cert-frame {
			border-color: #60a5fa;
		}

		.cert-border {
			border-color: #93bbfd;
		}

		.cert-title {
			color: #1d4ed8;
		}

		.cert-achievement {
			color: #2563eb;
		}

		.cert-stat-item {
			border-color: #bfdbfe;
			background: #eff6ff;
		}

		.cert-stat-value {
			color: #2563eb;
		}
	}
</style>
