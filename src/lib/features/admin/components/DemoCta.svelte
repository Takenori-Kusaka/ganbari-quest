<script lang="ts">
interface Props {
	title?: string;
	description?: string;
	ctaText?: string;
	ctaHref?: string;
}

let {
	title = 'いかがでしたか？',
	description = 'お子さまの「がんばり」を冒険に変えませんか？',
	ctaText = '無料で はじめる →',
	ctaHref = '/demo/signup',
}: Props = $props();
</script>

<div class="bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 rounded-xl p-4 text-center">
	<p class="text-sm font-bold text-gray-700 mb-1">{title}</p>
	<p class="text-xs text-gray-500 mb-3">{description}</p>
	<a
		href={ctaHref}
		class="inline-block w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold rounded-xl text-center text-sm"
	>
		{ctaText}
	</a>
</div>
