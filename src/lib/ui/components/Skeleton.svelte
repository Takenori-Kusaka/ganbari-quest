<script lang="ts">
interface Props {
	width?: string;
	height?: string;
	rounded?: 'sm' | 'md' | 'lg' | 'full';
	class?: string;
}

let { width = '100%', height = '1rem', rounded = 'md', class: className = '' }: Props = $props();

const roundedClass: Record<string, string> = {
	sm: 'rounded-sm',
	md: 'rounded-md',
	lg: 'rounded-lg',
	full: 'rounded-full',
};
</script>

<div
	class="skeleton {roundedClass[rounded]} {className}"
	style:width={width}
	style:height={height}
	aria-hidden="true"
></div>

<style>
	.skeleton {
		background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
