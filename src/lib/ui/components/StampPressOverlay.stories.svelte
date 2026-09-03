<script module>
// #4841: ログインボーナスの受取演出は年齢帯で文体が変わる (docs/DESIGN.md §8)。
// 実環境 (`DATA_SOURCE=demo`) では「当日まだ受け取っていない」状態を作れず SS 撮影で
// 描画できないため、本 story が preschool (ひらがな) / senior (漢字) の視覚証跡になる。
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import StampPressOverlay from './StampPressOverlay.svelte';

const { Story } = defineMeta({
	title: 'Components/StampPressOverlay',
	component: StampPressOverlay,
	tags: ['autodocs'],
});
</script>

<!-- 3-5 歳: 「3にちれんぞく！」「やったね！」 -->
<Story name="Preschool">
  <StampPressOverlay
    open={true}
    stampRarity="R"
    stampName={STORYBOOK_LABELS.stampPressOverlay.stampName}
    stampOmikujiRank={null}
    instantPoints={10}
    consecutiveDays={3}
    multiplier={1}
    cardFilledSlots={3}
    cardTotalSlots={5}
    cardEntries={[]}
    weeklyRedeem={null}
    uiMode="preschool"
  />
</Story>

<!-- 16-18 歳: 「3日連続！」「OK」 -->
<Story name="Senior">
  <StampPressOverlay
    open={true}
    stampRarity="R"
    stampName={STORYBOOK_LABELS.stampPressOverlay.stampName}
    stampOmikujiRank={null}
    instantPoints={10}
    consecutiveDays={3}
    multiplier={1}
    cardFilledSlots={3}
    cardTotalSlots={5}
    cardEntries={[]}
    weeklyRedeem={null}
    uiMode="senior"
  />
</Story>

<!-- 週次交換フェーズ (「つぎへ」/「次へ」で遷移する 2 画面目) -->
<Story name="SeniorWeeklyRedeem">
  <StampPressOverlay
    open={true}
    stampRarity="N"
    stampName={STORYBOOK_LABELS.stampPressOverlay.stampName}
    stampOmikujiRank={null}
    instantPoints={5}
    consecutiveDays={2}
    multiplier={1}
    cardFilledSlots={5}
    cardTotalSlots={5}
    cardEntries={[]}
    weeklyRedeem={{ points: 100, filledSlots: 5, totalSlots: 5, completeBonus: 50 }}
    uiMode="senior"
  />
</Story>
