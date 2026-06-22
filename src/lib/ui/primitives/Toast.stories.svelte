<script module>
/**
 * Toast.stories.svelte — CX-DoR #8 Storybook interaction test
 *
 * #3218 (EPIC #3217): error Toast の WCAG 準拠 role / 手動閉じを component 層で回帰する。
 *   - success/info → role="status"(polite) + 3 秒自動消滅 (操作不要・軽微通知)
 *   - error        → role="alert"(assertive) + 非自動消滅 + 手動 ✕ 閉じ (WCAG 2.2.1)
 * play は「button click → showToast → role / 手動閉じ」の DOM 観測可能な動線を検証する。
 * 自動消滅タイマー (3s) の非発火は showToast の `if (type !== 'error')` で構造保証され、
 * tests/unit/ui/error-notify.test.ts と併せて担保する (3s 待機の slow test は避ける)。
 */
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, screen, waitFor, within } from 'storybook/test';
import { STORYBOOK_LABELS, UI_PRIMITIVES_LABELS } from '$lib/domain/labels';
import Button from './Button.svelte';
import Toast, { showToast } from './Toast.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Toast',
	component: Toast,
	tags: ['autodocs'],
});
</script>

<Story
  name="Success"
  asChild
  play={async () => {
    // success → role="status"(polite) で render される (assertive で読み上げない軽微通知)
    const trigger = screen.getByRole('button', { name: STORYBOOK_LABELS.toast.successBtn });
    await trigger.click();
    // animate-bounce-in は opacity:0 起点のため toBeVisible は使わず DOM 存在 + 文言で検証する
    const status = await waitFor(() => screen.getByRole('status'));
    await expect(status).toBeInTheDocument();
    await expect(status).toHaveTextContent(STORYBOOK_LABELS.toast.successTitle);
  }}
>
  <div class="flex flex-col gap-2">
    <Button variant="primary" onclick={() => showToast(STORYBOOK_LABELS.toast.successTitle, STORYBOOK_LABELS.toast.successDesc, 'success')}>
      {STORYBOOK_LABELS.toast.successBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story
  name="Error"
  asChild
  play={async () => {
    // error → role="alert"(assertive) で即時読み上げ + 手動 ✕ で閉じる (非自動消滅)
    const trigger = screen.getByRole('button', { name: STORYBOOK_LABELS.toast.errorBtn });
    await trigger.click();
    const alert = await waitFor(() => screen.getByRole('alert'));
    await expect(alert).toBeInTheDocument();
    await expect(alert).toHaveTextContent(STORYBOOK_LABELS.toast.errorTitle);
    // 手動 ✕ (aria-label='とじる') で閉じる動線が健全 (dead-end でない)。
    // toasts は module-level state で story 間共有されるため close ボタンは alert 内に限定する。
    const closeBtn = within(alert).getByRole('button', { name: UI_PRIMITIVES_LABELS.closeAriaLabel });
    await closeBtn.click();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  }}
>
  <div class="flex flex-col gap-2">
    <Button variant="danger" onclick={() => showToast(STORYBOOK_LABELS.toast.errorTitle, STORYBOOK_LABELS.toast.errorDesc, 'error')}>
      {STORYBOOK_LABELS.toast.errorBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story name="Info" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="secondary" onclick={() => showToast(STORYBOOK_LABELS.toast.infoTitle, STORYBOOK_LABELS.toast.infoDesc, 'info')}>
      {STORYBOOK_LABELS.toast.infoBtn}
    </Button>
    <Toast />
  </div>
</Story>

<Story name="TitleOnly" asChild>
  <div class="flex flex-col gap-2">
    <Button variant="ghost" onclick={() => showToast(STORYBOOK_LABELS.toast.titleOnlyTitle)}>
      {STORYBOOK_LABELS.toast.titleOnlyBtn}
    </Button>
    <Toast />
  </div>
</Story>