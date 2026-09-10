<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, within } from 'storybook/test';
import { TRIAL_LABELS } from '$lib/domain/labels';
import TrialStartedNotice from './TrialStartedNotice.svelte';

// PO 決裁 2026-09-10 決定 3(a): 申込経路から自動で始まった無料体験を、着地直後に 1 度だけ告げる。
//
// 実画面では `?trialStarted=1` が付いた最初の描画にしか出ず、その状態は
// 「申込 → 登録 → テナント作成 → トライアル開始」を通過した直後にしか作れない。
// SS 撮影に使う demo 環境 (AUTH_MODE=anonymous) には申込も課金状態も無いので、
// 見た目と文言はここで見る。
const { Story } = defineMeta({
	title: 'Admin/TrialStartedNotice',
	component: TrialStartedNotice,
	tags: ['autodocs'],
});
</script>

<!--
	告知が出ている状態。**始まったこと**と**いつまで使えるか**の 2 つが揃っているかを見る。
	日付は「その日いっぱい使える最後の日」を出す (有効判定が当日を含むため)。
-->
<Story
	name="Started"
	args={{ endDate: '2026年9月17日' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const notice = canvas.getByTestId('trial-started-notice');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveTextContent(TRIAL_LABELS.startedNotice('2026年9月17日'));
		// 読み上げにも「状態の変化」として届く (ADR-0062 / NN/G #1)
		await expect(notice).toHaveAttribute('role', 'status');
	}}
/>

<!--
	開始していないとき。**始まっていないのに「始まりました」と出さない**ことを固定する。
	`endDate` が null になるのは「`?trialStarted=1` が無い」か「実際には体験中でない」ときで、
	どちらも告知してはいけない状態。
-->
<Story
	name="NotStarted"
	args={{ endDate: null }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('trial-started-notice')).toBeNull();
	}}
/>
