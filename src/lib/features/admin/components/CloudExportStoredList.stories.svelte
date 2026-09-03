<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import { SETTINGS_LABELS, STORYBOOK_LABELS } from '$lib/domain/labels';
import CloudExportStoredList from './CloudExportStoredList.svelte';

// #4767 PO 回答 #3: 保管枠を占有している全行 (DL 可 / 使い切り / 失敗 / 生成待ち / 生成中) を
// 状態付きで見せ、各行を削除できる。demo 環境 (DATA_SOURCE=demo) は cloud 行を持たないため
// 画面 SS が撮れず、本 story が見た目確認の SSOT になる (ss-render-impossible の参照先)。
const L = STORYBOOK_LABELS.cloudExportStoredList;

const base = {
	exportType: 'template',
	expiresAt: '2026-09-10T00:00:00.000Z',
	createdAt: '2026-09-03T01:00:00.000Z',
	description: L.descriptionTemplate,
	downloadCount: 0,
	maxDownloads: 5,
	status: 'ready',
	failureReason: null,
	rowState: 'downloadable',
	daysUntilAutoDelete: 7,
};

const rows = [
	{ ...base, id: 'dl', pinCode: 'ABC234' },
	{
		...base,
		id: 'exhausted',
		pinCode: 'DEF567',
		exportType: 'full',
		description: L.descriptionFull,
		downloadCount: 5,
		rowState: 'exhausted',
		createdAt: '2026-08-30T01:00:00.000Z',
		expiresAt: '2026-09-06T00:00:00.000Z',
		daysUntilAutoDelete: 3,
	},
	{
		...base,
		id: 'failed',
		pinCode: 'GHJ789',
		status: 'failed',
		failureReason: L.failureReason,
		rowState: 'failed',
		description: null,
	},
	{
		...base,
		id: 'pending',
		pinCode: 'KLM234',
		status: 'pending',
		rowState: 'pending',
		description: null,
	},
	{
		...base,
		id: 'building',
		pinCode: 'NPQ567',
		status: 'building',
		rowState: 'building',
		description: null,
	},
];

// 既存 stories (AdminResourceHeader / DowngradeResourceSelector) と同じく module-level spy を使う。
const deleteSpy = fn();

const { Story } = defineMeta({
	title: 'Admin/CloudExportStoredList',
	component: CloudExportStoredList,
	tags: ['autodocs'],
	args: { exports: rows, deletingId: null, onDelete: deleteSpy },
});
</script>

<Story
	name="AllStates"
	play={async ({ canvasElement }) => {
		deleteSpy.mockClear();
		const canvas = within(canvasElement);
		await expect(canvas.getByTestId('cloud-export-stored-list')).toBeVisible();
		// 5 状態すべてが枠を占有する行として並ぶ (使い切り / 失敗も落とさない)
		await expect(canvas.getByTestId('cloud-export-status-dl')).toHaveTextContent(
			SETTINGS_LABELS.cloudRowStateDownloadable,
		);
		await expect(canvas.getByTestId('cloud-export-status-exhausted')).toHaveTextContent(
			SETTINGS_LABELS.cloudRowStateExhausted,
		);
		await expect(canvas.getByTestId('cloud-export-status-failed')).toHaveTextContent(
			SETTINGS_LABELS.cloudRowStateFailed,
		);
		await expect(canvas.getByTestId('cloud-export-status-pending')).toHaveTextContent(
			SETTINGS_LABELS.cloudStatusPending,
		);
		await expect(canvas.getByTestId('cloud-export-status-building')).toHaveTextContent(
			SETTINGS_LABELS.cloudStatusBuilding,
		);
		// 自動削除までの残日数は全行に出る
		await expect(canvas.getByTestId('cloud-export-row-exhausted')).toHaveTextContent(
			SETTINGS_LABELS.cloudAutoDeleteIn(3),
		);
		// DL 導線は取り出せる行だけ、削除は全行
		await expect(canvas.getAllByTestId('cloud-export-download-link')).toHaveLength(1);
		await expect(canvas.getAllByRole('button', { name: SETTINGS_LABELS.cloudStoredDelete })).toHaveLength(5);
		// #4767 QM must: 削除は取り消せないので、押しただけでは実行されず確認 dialog が開く。
		// (Dialog は Portal 経由で body に出るため screen で引く)
		await userEvent.click(canvas.getByTestId('cloud-export-delete-exhausted'));
		const target = await screen.findByTestId('cloud-export-delete-confirm-target');
		await expect(target).toHaveTextContent('DEF567');
		await expect(deleteSpy).not.toHaveBeenCalled();
		// 確定して初めて callback が id 付きで呼ばれる
		await userEvent.click(screen.getByTestId('cloud-export-delete-execute'));
		await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('exhausted'));
	}}
/>

<Story
	name="Deleting"
	args={{ deletingId: 'exhausted' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const deleting = canvas.getByTestId('cloud-export-delete-exhausted');
		await expect(deleting).toHaveAttribute('aria-busy', 'true');
		await expect(deleting).toHaveTextContent(SETTINGS_LABELS.cloudStoredDeleting);
		// 削除中は他行の削除も止める (二重送信防止)
		await expect(canvas.getByTestId('cloud-export-delete-dl')).toBeDisabled();
	}}
/>

<!-- 取り消せない操作なので「やめる」で確実に何も起きないことを固定する (#4767 QM must) -->
<Story
	name="ConfirmCancel"
	play={async ({ canvasElement }) => {
		deleteSpy.mockClear();
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByTestId('cloud-export-delete-dl'));
		await screen.findByTestId('cloud-export-delete-confirm-target');
		await userEvent.click(screen.getByTestId('cloud-export-delete-cancel'));
		await waitFor(() =>
			expect(screen.queryByTestId('cloud-export-delete-confirm-target')).toBeNull(),
		);
		await expect(deleteSpy).not.toHaveBeenCalled();
		// 行は残ったまま
		await expect(canvas.getByTestId('cloud-export-row-dl')).toBeVisible();
	}}
/>

<Story
	name="Empty"
	args={{ exports: [] }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByTestId('cloud-export-stored-list')).toBeNull();
	}}
/>
