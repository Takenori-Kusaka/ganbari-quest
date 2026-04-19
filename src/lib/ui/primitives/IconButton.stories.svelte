<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import IconButton from './IconButton.svelte';

const { Story } = defineMeta({
	title: 'Primitives/IconButton',
	component: IconButton,
	tags: ['autodocs'],
});
</script>

<Story name="Primary"><IconButton variant="primary" label="編集">✏️</IconButton></Story>
<Story name="Secondary"><IconButton variant="secondary" label="編集">✏️</IconButton></Story>
<Story name="Danger"><IconButton variant="danger" label="削除">🗑️</IconButton></Story>
<Story name="Ghost"><IconButton variant="ghost" label="閉じる">✕</IconButton></Story>
<Story name="Outline"><IconButton variant="outline" label="編集">✏️</IconButton></Story>

<Story name="AllVariants">
  <div class="flex gap-2 items-center">
    <IconButton variant="primary" label="編集">✏️</IconButton>
    <IconButton variant="secondary" label="編集">✏️</IconButton>
    <IconButton variant="danger" label="削除">🗑️</IconButton>
    <IconButton variant="ghost" label="閉じる">✕</IconButton>
    <IconButton variant="warning" label="注意">⚠️</IconButton>
    <IconButton variant="success" label="確認">✓</IconButton>
    <IconButton variant="outline" label="編集">✏️</IconButton>
  </div>
</Story>

<Story name="AllSizes">
  <div class="flex gap-2 items-center">
    <IconButton variant="primary" label="小" size="sm">✏️</IconButton>
    <IconButton variant="primary" label="中" size="md">✏️</IconButton>
    <IconButton variant="primary" label="大" size="lg">✏️</IconButton>
  </div>
</Story>
