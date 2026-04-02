<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Button from './Button.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Button',
	component: Button,
	tags: ['autodocs'],
});
</script>

<Story name="Primary">
  <Button variant="primary">ボタン</Button>
</Story>

<Story name="Secondary">
  <Button variant="secondary">セカンダリ</Button>
</Story>

<Story name="Danger">
  <Button variant="danger">削除する</Button>
</Story>

<Story name="Ghost">
  <Button variant="ghost">キャンセル</Button>
</Story>

<Story name="Success">
  <Button variant="success">追加する</Button>
</Story>

<Story name="Outline">
  <Button variant="outline">もどる</Button>
</Story>

<Story name="Small">
  <Button variant="primary" size="sm">小さいボタン</Button>
</Story>

<Story name="Large">
  <Button variant="primary" size="lg">大きいボタン</Button>
</Story>

<Story name="Disabled">
  <Button variant="primary" disabled>無効</Button>
</Story>

<Story name="AllVariants">
  <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="danger">Danger</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="success">Success</Button>
    <Button variant="outline">Outline</Button>
  </div>
</Story>

<Story name="AllSizes">
  <div style="display: flex; gap: 8px; align-items: center;">
    <Button variant="primary" size="sm">Small</Button>
    <Button variant="primary" size="md">Medium</Button>
    <Button variant="primary" size="lg">Large</Button>
  </div>
</Story>
