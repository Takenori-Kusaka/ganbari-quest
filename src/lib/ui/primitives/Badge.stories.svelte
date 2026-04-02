<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import Badge from './Badge.svelte';

const { Story } = defineMeta({
	title: 'Primitives/Badge',
	component: Badge,
	tags: ['autodocs'],
});
</script>

<Story name="Success"><Badge variant="success">完了</Badge></Story>
<Story name="Warning"><Badge variant="warning">注意</Badge></Story>
<Story name="Danger"><Badge variant="danger">エラー</Badge></Story>
<Story name="Info"><Badge variant="info">情報</Badge></Story>
<Story name="Neutral"><Badge variant="neutral">ニュートラル</Badge></Story>
<Story name="Accent"><Badge variant="accent">アクセント</Badge></Story>

<Story name="AllVariants">
  <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
    <Badge variant="success">完了</Badge>
    <Badge variant="warning">注意</Badge>
    <Badge variant="danger">エラー</Badge>
    <Badge variant="info">情報</Badge>
    <Badge variant="neutral">ニュートラル</Badge>
    <Badge variant="accent">アクセント</Badge>
  </div>
</Story>

<Story name="SmallSize">
  <div style="display: flex; gap: 8px;">
    <Badge variant="success" size="sm">小</Badge>
    <Badge variant="success" size="md">中</Badge>
  </div>
</Story>
