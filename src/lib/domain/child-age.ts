// src/lib/domain/child-age.ts
// #4718: 子供の「年齢」と「誕生日」の保存・導出規約 (全 backend 共通の SSOT)。
//
// 背景: 初回セットアップ (`/setup/children`) は年齢しか聞かない。pg-core backend (cloud DSQL /
// NUC PGlite) の children 表は age 列を持たず birth_date だけが年齢ソース (compute-on-read) の
// ため、年齢だけで登録した子供が本番では「0歳」になっていた (sqlite は age 列に保存するため
// 再現しない)。backend ごとに導出が食い違わないよう、規約をここに 1 つ置き、各 repo は
// この関数を呼ぶだけにする。
//
// 規約:
//   - 保存は常に birth_date を持つ。誕生日が入力されなければ **年齢から合成した推定誕生日**
//     (JST 暦日で「今年 − 年齢」年の 1 月 1 日) を保存し、`birth_date_estimated = true` で印を付ける。
//     1/1 固定なので、合成直後の calculateAge は入力年齢と一致し、以後は毎年 1/1 に 1 つ増える
//     (age-recalc cron / compute-on-read と整合)。
//   - 読み出しの年齢は birth_date から導出する (`deriveChildAge`)。birth_date が無い旧行だけ
//     stored age (sqlite) にフォールバックする。
//   - 公開 entity の `birthDate` は **保護者が入力した実誕生日のみ** (`publicBirthDate`)。推定値は
//     null として返すので、誕生日ボーナス / 🎂 表示 / 月齢表示 / export はこれまでどおり
//     「誕生日を入れた子だけ」が対象になる (推定 1/1 で誕生日を祝わない)。
//   - 更新で age だけが来たとき、実誕生日を持つ子の birth_date は上書きしない (誕生日が SSOT)。
//     推定 or 未設定の子だけ推定値を差し替える。

import { calculateAgeFromBirthDate, todayDateJST } from './date-utils';
import { AGE_TIER_CONFIG, type UiMode } from './validation/age-tier';

/** 保存する誕生日の形 (birth_date は必ず埋まる)。 */
export interface ChildBirthStorage {
	birthDate: string;
	birthDateEstimated: boolean;
}

/** 年齢だけ分かっている子供の推定誕生日 (JST 暦日基準、「今年 − 年齢」年の 1 月 1 日)。 */
export function estimateBirthDateFromAge(age: number, today: string = todayDateJST()): string {
	const year = Number(today.slice(0, 4));
	const safeAge = Number.isFinite(age) ? Math.max(0, Math.floor(age)) : 0;
	return `${String(year - safeAge).padStart(4, '0')}-01-01`;
}

/**
 * 旧行 backfill 用: ui_mode (登録時の年齢帯) からその帯の代表年齢を返す。
 * 年齢帯の中央値 (baby 1 / preschool 4 / elementary 9 / junior 14 / senior 17)。
 * pg-core の旧行 (birth_date NULL、age 情報なし) は ui_mode だけが年齢の手掛かりのため、
 * 0 歳のままにせず帯の代表年齢で推定誕生日を合成する (保護者は編集画面で修正できる)。
 */
export function representativeAgeForUiMode(uiMode: string): number {
	const tier = AGE_TIER_CONFIG[uiMode as UiMode];
	if (!tier) return representativeAgeForUiMode('elementary');
	return Math.floor((tier.ageMin + tier.ageMax) / 2);
}

/** 新規登録の入力 → 保存値。誕生日入力があれば実値、無ければ年齢から推定。 */
export function resolveBirthDateForInsert(
	input: { age: number; birthDate?: string | null },
	today: string = todayDateJST(),
): ChildBirthStorage {
	if (input.birthDate) return { birthDate: input.birthDate, birthDateEstimated: false };
	return { birthDate: estimateBirthDateFromAge(input.age, today), birthDateEstimated: true };
}

/**
 * 更新入力 → birth_date / birth_date_estimated の差分。`undefined` = その列は触らない。
 *
 * - `birthDate` に実値 → 実誕生日として保存 (estimated=false)
 * - `birthDate: null` (誕生日をクリア) → age があれば推定値、無ければ現在値を推定扱いに降格
 * - `birthDate` 未指定で `age` のみ → 現在が推定 or 未設定のときだけ推定値を差し替える
 *   (実誕生日は年齢入力で上書きしない。age-recalc cron の age 同期もここを通る)
 */
export function resolveBirthDateForUpdate(
	input: { age?: number; birthDate?: string | null },
	current: { birthDate: string | null; birthDateEstimated: boolean },
	today: string = todayDateJST(),
): Partial<ChildBirthStorage> {
	if (input.birthDate) return { birthDate: input.birthDate, birthDateEstimated: false };
	if (input.birthDate === null) {
		if (input.age !== undefined) {
			return { birthDate: estimateBirthDateFromAge(input.age, today), birthDateEstimated: true };
		}
		// 誕生日欄だけを空にして保存した場合 (年齢欄も空 / 不正で age が来ないケース)。
		//
		// **保存値は消さず「推定扱いへの降格」に留める**。`publicBirthDate` が
		// estimated=true を null で返すため、画面・export・誕生日ボーナスの対象からは外れる。
		// 月日を実際に破棄すると、誤って空にした保護者が再入力するまで復旧できない
		// (再入力を促す導線も無い)。一方で「保存値が残ること」自体を消去要求と読むかは
		// プロダクト判断なので、QM #4729 レビューで PO 判断事項として起票した。
		// ここでは既存契約 (降格) を維持する。
		return current.birthDate ? { birthDateEstimated: true } : {};
	}
	if (input.age === undefined) return {};
	if (current.birthDate && !current.birthDateEstimated) return {};
	return { birthDate: estimateBirthDateFromAge(input.age, today), birthDateEstimated: true };
}

/**
 * 読み出し時の年齢 (全 backend 共通)。birth_date があればそこから導出 (誕生日跨ぎで自動加算)、
 * 無い旧行は stored age (sqlite の age 列) にフォールバック、それも無ければ 0。
 */
export function deriveChildAge(
	row: { birthDate: string | null; age?: number | null },
	today: string = todayDateJST(),
): number {
	if (row.birthDate) return calculateAgeFromBirthDate(row.birthDate, today);
	return row.age ?? 0;
}

/** 公開 entity の誕生日: 保護者入力の実誕生日のみ。推定値は null (誕生日ボーナス等の対象外)。 */
export function publicBirthDate(row: {
	birthDate: string | null;
	birthDateEstimated: boolean;
}): string | null {
	if (!row.birthDate || row.birthDateEstimated) return null;
	return row.birthDate;
}

/**
 * アプリの対象年齢の上限 (ADR-0011: コアターゲット 3〜18 歳、0〜2 歳は親の準備モード)。
 * 誕生日から導出した年齢はここで丸める。
 */
export const CHILD_AGE_MAX = 18;

/**
 * 誕生日から**登録に使う年齢**を導く (#4718 QM)。
 *
 * `calculateAgeFromBirthDate` の生値ではなく {@link CHILD_AGE_MAX} で丸める。
 * 丸めないと、19 歳以上になる誕生日を入れた保護者に「年齢は 0〜18 で入力してください」と返るが、
 * **その年齢欄は誕生日を入れた時点で disabled になっていて直せない** (初回セットアップの行き止まり)。
 * admin 側 (`admin/children/+page.server.ts`) は元から丸めており、setup 側だけが生値を見ていた。
 * 両者が同じ規則を使うよう、丸めをここ 1 箇所に閉じる。
 */
export function childAgeFromBirthDate(birthDate: string, today: string = todayDateJST()): number {
	return Math.min(CHILD_AGE_MAX, calculateAgeFromBirthDate(birthDate, today));
}
