<script lang="ts">
/**
 * ActivityIntroCard — 活動紹介スライドのカード表示
 *
 * 動的な border-color を style directive で設定するため、
 * route ファイルから分離してデザインシステム層に配置。
 */
import CompoundIcon from '$lib/ui/components/CompoundIcon.svelte';

interface Props {
	/** 活動アイコン（絵文字 or compound icon 文字列） */
	icon: string;
	/** 活動名 */
	name: string;
	/** カテゴリカラー（CSS カラー値） */
	borderColor: string;
}

let { icon, name, borderColor }: Props = $props();
</script>

<div
	class="w-40 aspect-square rounded-2xl border-3 shadow-lg flex flex-col items-center justify-center gap-2 bg-white transition-all duration-300"
	style:border-color={borderColor}
>
	<CompoundIcon {icon} size="xl" />
	<span class="text-base font-bold text-gray-700 text-center leading-tight px-2">
		{name}
	</span>
</div>
