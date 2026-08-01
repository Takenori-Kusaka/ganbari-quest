<script module>
// #4172: 本 overlay は「棚に未表示のごほうびがある」お知らせであって、ポイントの獲得通知ではない。
// `points` は交換に必要なポイント (価格) を示す (06-UI設計書 §4.16 / 26-ゲーミフィケーション設計書 §12.2)。
//
// 実環境 (`DATA_SOURCE=demo`) では `demo-service.ts` が `latestReward: null` を返すため
// SS 撮影で描画できない。本 story が表示の唯一の視覚証跡になる。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import SpecialRewardOverlay from './SpecialRewardOverlay.svelte';

const { Story } = defineMeta({
	title: 'Components/SpecialRewardOverlay',
	component: SpecialRewardOverlay,
	tags: ['autodocs'],
});
</script>

<Story name="Default">
  <SpecialRewardOverlay
    open={true}
    title={STORYBOOK_LABELS.specialRewardOverlay.title}
    points={500}
    icon="🎮"
  />
</Story>

<Story name="Long Title (折り返し確認)">
  <SpecialRewardOverlay
    open={true}
    title={STORYBOOK_LABELS.specialRewardOverlay.titleLong}
    points={1200}
    icon="🏞️"
  />
</Story>

<Story name="No Icon (🎁 fallback)">
  <SpecialRewardOverlay
    open={true}
    title={STORYBOOK_LABELS.specialRewardOverlay.title}
    points={50}
    icon={null}
  />
</Story>
