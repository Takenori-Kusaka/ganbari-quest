<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { STORYBOOK_LABELS } from '$lib/domain/labels';
import ErrorAlert from './ErrorAlert.svelte';

const { Story } = defineMeta({
	title: 'Components/ErrorAlert',
	component: ErrorAlert,
	tags: ['autodocs'],
});
</script>

<Story name="Error (Default)">
  <ErrorAlert message={STORYBOOK_LABELS.errorAlert.defaultMessage} />
</Story>

<Story name="Warning">
  <ErrorAlert message={STORYBOOK_LABELS.errorAlert.warningMessage} severity="warning" />
</Story>

<Story name="Info">
  <ErrorAlert message={STORYBOOK_LABELS.errorAlert.infoMessage} severity="info" />
</Story>

<Story name="Error with Retry Action">
  <ErrorAlert
    message={STORYBOOK_LABELS.errorAlert.retryActionMessage}
    severity="error"
    action="retry"
  />
</Story>

<Story name="Error with Retry Button">
  <ErrorAlert
    message={STORYBOOK_LABELS.errorAlert.retryButtonMessage}
    severity="error"
    action="retry"
    onretry={() => alert(STORYBOOK_LABELS.errorAlert.retryAlertMessage)}
  />
</Story>

<Story name="Warning with Fix Input">
  <ErrorAlert
    message={STORYBOOK_LABELS.errorAlert.fixInputMessage}
    severity="warning"
    action="fix_input"
  />
</Story>

<Story name="Error with Contact Admin">
  <ErrorAlert
    message={STORYBOOK_LABELS.errorAlert.contactAdminMessage}
    severity="error"
    action="contact_admin"
  />
</Story>

<Story name="All Severities">
  <div class="flex flex-col gap-2" style="max-width: 480px;">
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.successSeverity} severity="info" />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.warningSeverity} severity="warning" />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.errorSeverity} severity="error" />
  </div>
</Story>

<Story name="All Action Types">
  <div class="flex flex-col gap-2" style="max-width: 480px;">
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.actionNoneMessage} severity="error" action="none" />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.actionRetryTextMessage} severity="error" action="retry" />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.actionRetryButtonMessage} severity="error" action="retry" onretry={() => alert(STORYBOOK_LABELS.errorAlert.retryClickAlert)} />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.actionFixInputMessage} severity="warning" action="fix_input" />
    <ErrorAlert message={STORYBOOK_LABELS.errorAlert.actionContactAdminMessage} severity="error" action="contact_admin" />
  </div>
</Story>

<Story name="Long Message">
  <div style="max-width: 480px;">
    <ErrorAlert
      message={STORYBOOK_LABELS.errorAlert.longMessage}
      severity="error"
      action="retry"
      onretry={() => alert(STORYBOOK_LABELS.errorAlert.retryClickAlert)}
    />
  </div>
</Story>
