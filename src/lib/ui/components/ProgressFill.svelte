<script lang="ts">
/**
 * ProgressFill — progress bar の塗りつぶし部分
 *
 * 動的な width / background-color を style directive で設定するラッパー。
 * route ファイルで style:prop を直接書くと ESLint svelte/no-inline-styles に
 * 抵触するため、デザインシステム層のこのコンポーネントに encapsulate する。
 */
interface Props {
	/** 0-100 の進捗パーセンテージ */
	pct: number;
	/** 動的な背景色（CSS変数またはカラー値） */
	color?: string;
	/** 追加の CSS クラス */
	class?: string;
}

let { pct, color, class: className = '' }: Props = $props();
</script>

{#if color}
	<div class={className} style:width="{pct}%" style:background-color={color}></div>
{:else}
	<div class={className} style:width="{pct}%"></div>
{/if}
