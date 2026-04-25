<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import BabyHomePage from './BabyHomePage.svelte';

const { Story } = defineMeta({
	title: 'Features/ChildHome/BabyHomePage',
	component: BabyHomePage,
	tags: ['autodocs'],
});
</script>

<Story name="Default (no birthDate, balance 0)">
  <BabyHomePage child={{ nickname: 'はなこちゃん', age: 1 }} balance={0} />
</Story>

<Story name="With initial points balance">
  <BabyHomePage child={{ nickname: 'はなこちゃん', age: 1 }} balance={500} />
</Story>

<Story name="With birthDate — 8 months old">
  <BabyHomePage
    child={{ nickname: 'はなこちゃん', age: 0, birthDate: (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 8);
      return d.toISOString().slice(0, 10);
    })() }}
    balance={0}
  />
</Story>

<Story name="With birthDate — nearly 3 years old">
  <BabyHomePage
    child={{ nickname: 'はなこちゃん', age: 2, birthDate: (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 2);
      d.setMonth(d.getMonth() - 11);
      return d.toISOString().slice(0, 10);
    })() }}
    balance={200}
  />
</Story>

<Story name="Reached 3 years">
  <BabyHomePage
    child={{ nickname: 'はなこちゃん', age: 3, birthDate: (() => {
      const d = new Date();
      d.setFullYear(d.getFullYear() - 3);
      return d.toISOString().slice(0, 10);
    })() }}
    balance={1000}
  />
</Story>
