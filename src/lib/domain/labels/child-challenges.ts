// labels 層 (ADR-0045 / #4965): 子供のチャレンジ画面 (週次チャレンジの題名・理由の年齢帯表記。保存値として親の管理画面にも出る)。置き場所の規則は docs/DESIGN.md §6
import { normalizeUiMode } from '../validation/age-tier-types';

/**
 * #4690 F2: 週次チャレンジの提案理由・タイトル（年齢帯 2 変種）。
 *
 * 旧実装は `child-challenge-service.ts` に日本語 4 文を直書きし、全年齢に同じ漢字文を
 * 出していた（実測: `/preschool/challenges` に「最近「こうりゅう」が少なめだったから、
 * 今週はチャレンジしてみよう！」）。表示文言はサービス層ではなくここが置き場所
 * （ADR-0045）。文体の分かれ目は docs/DESIGN.md §8。
 */
type ChallengeReasonMode = 'weakness' | 'strength' | 'rescue-strength' | 'explore';

/** 子供に見せるチャレンジ理由文。categoryName は呼び出し側が年齢帯に合わせて解決して渡す。 */
export function getChallengeReason(
	mode: ChallengeReasonMode,
	categoryName: string,
	uiMode: string,
): string {
	const kana = (() => {
		const m = normalizeUiMode(uiMode);
		return m === 'baby' || m === 'preschool';
	})();
	switch (mode) {
		case 'explore':
			return kana
				? 'まだ きろくが すくないから、いろんなことを やってみよう！'
				: 'まだ記録が少ないので、いろんなことにチャレンジしてみよう！';
		case 'strength':
			return kana
				? `とくいな「${categoryName}」を もっと のばしてみよう！`
				: `得意な「${categoryName}」をもっと伸ばしてみよう！`;
		case 'rescue-strength':
			return kana
				? `とくいな「${categoryName}」で ちょうしを とりもどそう！`
				: `得意な「${categoryName}」でリズムを取り戻そう！`;
		default:
			return kana
				? `さいきん「${categoryName}」が すくなめだったから、こんしゅう やってみよう！`
				: `最近「${categoryName}」が少なめだったから、今週はチャレンジしてみよう！`;
	}
}

/**
 * 週次チャレンジのタイトル。DB には既定 (漢字) で保存し、表示時は
 * `resolveChallengeDisplayTitle` (child-challenge-service) が targetConfig の構造値から
 * 年齢帯の文体で解決し直す (#4690 / src/routes/CLAUDE.md「保存値を出さず構造値から解決」)。
 * baby / preschool はひらがな。
 */
export function formatChallengeTitle(
	categoryName: string,
	targetCount: number,
	uiMode: string = 'senior',
): string {
	const m = normalizeUiMode(uiMode);
	if (m === 'baby' || m === 'preschool')
		return `こんしゅうは「${categoryName}」を${targetCount}かい`;
	return `今週は「${categoryName}」を${targetCount}回`;
}
