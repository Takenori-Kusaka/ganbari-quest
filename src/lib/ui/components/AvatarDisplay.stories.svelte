<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import AvatarDisplay from './AvatarDisplay.svelte';

// #4429: 「画像の取得に失敗したときに何が描画されるか」を目で確かめるための story。
// この状態は demo 環境 (DATA_SOURCE=demo) では作れない — demo データのアバターは常に取得できるため。
// Storybook なら到達不能な src を渡すだけで再現でき、壊れ画像アイコンではなく 👤 が出ることを
// 視認できる (docs/DESIGN.md §8: 文字の読めない baby / preschool には壊れ画像は伝わらない)。
const { Story } = defineMeta({
	title: 'Components/AvatarDisplay',
	component: AvatarDisplay,
	tags: ['autodocs'],
});

const nickname = STORYBOOK_LABELS.avatarDisplay.nickname;
// 到達不能な URL。読み込みは必ず失敗し、onerror → 👤 フォールバックが発火する。
const BROKEN_URL = '/tenants/storybook-unreachable/avatars/0/does-not-exist.png';
</script>

<Story name="NoAvatar">
  <AvatarDisplay {nickname} avatarUrl={null} size="lg" />
</Story>

<Story name="ImageLoadFailed">
  <!-- 取得に失敗する URL を渡した状態。ブラウザ既定の壊れ画像ではなく 👤 が出る。 -->
  <AvatarDisplay {nickname} avatarUrl={BROKEN_URL} size="lg" />
</Story>

<Story name="ImageLoadFailedAllSizes">
  <div style="display: flex; align-items: center; gap: 16px;">
    <AvatarDisplay {nickname} avatarUrl={BROKEN_URL} size="sm" />
    <AvatarDisplay {nickname} avatarUrl={BROKEN_URL} size="md" />
    <AvatarDisplay {nickname} avatarUrl={BROKEN_URL} size="lg" />
  </div>
</Story>
