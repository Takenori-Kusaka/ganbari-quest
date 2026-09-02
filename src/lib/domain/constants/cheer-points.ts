// src/lib/domain/constants/cheer-points.ts
// 応援 (cheer) のボーナスポイント値域と既定値の SSOT (#4659、EPIC #4650)。
//
// 背景:
//   値域 (1〜10000) は `cheer-service.ts` (server 専用 module) に、既定値 (50) は
//   `/admin/cheer` の `+page.svelte` にそれぞれ直書きされており、domain 層 (labels.ts の
//   ページガイド文言) からは参照できなかった。そのためガイドは「多め・少なめ」としか書けず、
//   顧客の「何ポイントまで送れる? いくつが目安?」に答えられていなかった。
//   ガイド側に数値をリテラルで書くと実装を変えたときに古い案内が残るため (plan-quota.ts #4655 /
//   plan-retention.ts #4477 と同型)、値を domain leaf に降ろし、server / UI / ガイドが同じ定数を引く。

/**
 * 応援ポイントの値域と既定値。**この 3 つの数値がプロダクト全体の SSOT**。
 * 表示文字列側に数値を複製しないこと (ガイド文言は `${CHEER_POINTS.max}` 等で参照する)。
 */
export const CHEER_POINTS = {
	/** 付与できる最小ポイント (cheer-service の入力バリデーション) */
	min: 1,
	/** 付与できる最大ポイント (同上) */
	max: 10000,
	/** 応援フォームの初期値 */
	default: 50,
} as const;
