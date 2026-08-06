<script module>
import { defineMeta } from '@storybook/addon-svelte-csf';
import { formatPointValue } from '$lib/domain/point-display';
import HabitCertificateNoticeBanner from './HabitCertificateNoticeBanner.svelte';

/**
 * #4261 ③: 4 つの子供向け年齢モードで文言と折り返しが成立することを確認する。
 * baby は親向けの準備モードで子供向けホームを持たない (ADR-0011) ため story を持たない。
 */
const POINT_AMOUNT = formatPointValue(50, 'point', 'JPY', 1);
const CURRENCY_AMOUNT = formatPointValue(50, 'currency', 'JPY', 1);

const { Story } = defineMeta({
	title: 'Child/HabitCertificateNoticeBanner',
	component: HabitCertificateNoticeBanner,
	tags: ['autodocs'],
	args: { visible: true, uiMode: 'elementary', amount: POINT_AMOUNT },
});
</script>

<Story name="Preschool" args={{ visible: true, uiMode: 'preschool', amount: POINT_AMOUNT }} />
<Story name="Elementary" args={{ visible: true, uiMode: 'elementary', amount: POINT_AMOUNT }} />
<Story name="Junior" args={{ visible: true, uiMode: 'junior', amount: POINT_AMOUNT }} />
<Story name="Senior" args={{ visible: true, uiMode: 'senior', amount: POINT_AMOUNT }} />
<!-- ポイント表示をおこづかい (通貨) に切り替えている家庭 -->
<Story name="CurrencyMode" args={{ visible: true, uiMode: 'elementary', amount: CURRENCY_AMOUNT }} />
<Story name="Hidden" args={{ visible: false, uiMode: 'elementary', amount: POINT_AMOUNT }} />
