<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import ErrorAlert from './ErrorAlert.svelte';

const { Story } = defineMeta({
	title: 'Components/ErrorAlert',
	component: ErrorAlert,
	tags: ['autodocs'],
});
</script>

<Story name="Error (Default)">
  <ErrorAlert message="データの読み込みに失敗しました。" />
</Story>

<Story name="Warning">
  <ErrorAlert message="セッションの有効期限が近づいています。" severity="warning" />
</Story>

<Story name="Info">
  <ErrorAlert message="メンテナンスのお知らせ: 明日 AM2:00-4:00 にサーバーメンテナンスを実施します。" severity="info" />
</Story>

<Story name="Error with Retry Action">
  <ErrorAlert
    message="サーバーに接続できませんでした。"
    severity="error"
    action="retry"
  />
</Story>

<Story name="Error with Retry Button">
  <ErrorAlert
    message="データの保存に失敗しました。"
    severity="error"
    action="retry"
    onretry={() => alert('リトライを実行しました')}
  />
</Story>

<Story name="Warning with Fix Input">
  <ErrorAlert
    message="PINコードが正しくありません。"
    severity="warning"
    action="fix_input"
  />
</Story>

<Story name="Error with Contact Admin">
  <ErrorAlert
    message="予期しないエラーが発生しました。"
    severity="error"
    action="contact_admin"
  />
</Story>

<Story name="All Severities">
  <div class="flex flex-col gap-2" style="max-width: 480px;">
    <ErrorAlert message="正常に処理されました。" severity="info" />
    <ErrorAlert message="操作の確認が必要です。" severity="warning" />
    <ErrorAlert message="エラーが発生しました。" severity="error" />
  </div>
</Story>

<Story name="All Action Types">
  <div class="flex flex-col gap-2" style="max-width: 480px;">
    <ErrorAlert message="アクションなし" severity="error" action="none" />
    <ErrorAlert message="リトライ案内 (テキストのみ)" severity="error" action="retry" />
    <ErrorAlert message="リトライボタン付き" severity="error" action="retry" onretry={() => alert('リトライ')} />
    <ErrorAlert message="入力修正を案内" severity="warning" action="fix_input" />
    <ErrorAlert message="管理者への連絡を案内" severity="error" action="contact_admin" />
  </div>
</Story>

<Story name="Long Message">
  <div style="max-width: 480px;">
    <ErrorAlert
      message="データベースへの接続がタイムアウトしました。サーバーが高負荷状態にある可能性があります。しばらく時間をおいてから再度お試しください。問題が続く場合は管理者までお問い合わせください。"
      severity="error"
      action="retry"
      onretry={() => alert('リトライ')}
    />
  </div>
</Story>
