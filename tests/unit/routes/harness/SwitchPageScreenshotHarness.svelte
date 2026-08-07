<script lang="ts">
// /switch のスクロールロック回帰テスト用ハーネス (#4417 AC3 / #4439 の後追い)。
//
// 本番では root `+layout.svelte` が `setScreenshotModeContext()` で screenshot mode を配る。
// component 層テストは layout を経由しないため、同じ公開 API で context を張り、
// `?screenshot=all` 相当の overlay 表示 / 非表示を prop から駆動できるようにする。
// 検証対象の `+page.svelte` 自体には一切手を入れない (テスト用の複製を作らない)。
import type { Component } from 'svelte';
import { type ScreenshotMode, setScreenshotModeContext } from '$lib/features/demo/screenshot-mode';
import SwitchPageRaw from '../../../../src/routes/switch/+page.svelte';

let { mode, data }: { mode: ScreenshotMode; data: unknown } = $props();

setScreenshotModeContext(
	() => mode !== 'off',
	() => mode,
);

// `+page.svelte` の props は SvelteKit 生成型 (PageData) に紐づくため、テスト用の
// 最小 data を渡せるよう unknown 受けの Component 型へ寄せる (既存 switch-parent-gate-reopen.test.ts と同型)。
const SwitchPage = SwitchPageRaw as unknown as Component<{ data: unknown }>;
</script>

<SwitchPage {data} />
