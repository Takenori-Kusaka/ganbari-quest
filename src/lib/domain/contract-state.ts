// src/lib/domain/contract-state.ts
//
// `families` の契約 4 列を、**設計書の状態表に照らして分類する** (#4181)。
//
// ## SSOT
//
// `docs/design/billing-redesign/contract-state-matrix.md` §4 が SSOT で、**本ファイルはその写し**である。
// 表に状態を足したのに実装が追随しない（またはその逆）は
// `tests/unit/architecture/contract-state-matrix-ssot.test.ts` が CI で落とす。
//
// ## なぜ要るか
//
// 契約状態の書き手は **9 箇所**ある (matrix §5)。表は「どの組み合わせが正しいか」を人間向けに
// 書いたものなので、**新しい webhook handler が表に無い組み合わせを書いても誰も気づかない**。
// 4 列は課金状態そのもので、顧客の請求と機能解放に直結する。
//
// 2026-07-26 の実障害は「webhook が届かず更新されない」ケースだったが、
// **届いたうえで不正な組み合わせを書く**経路は無防備のままだった。
//
// ## 全域であること
//
// 判定は 4 列の全組み合わせ (4 × 2 × 2 × 2 = 32) に対して**全域**である。
// 表に無い組み合わせを S* / X* のどれかに丸めると、**表に無い状態が正常として通る**ため、
// `UNCLASSIFIED` を返して明示する。`UNCLASSIFIED` は「不正と判っている」ではなく
// 「**表がまだ何も言っていない**」であり、X* とは意味が違う (混ぜると是正の当て先を誤る)。

import { SUBSCRIPTION_STATUS } from '$lib/domain/constants/subscription-status';

/** 正常状態 (matrix §4 の表)。 */
export const VALID_CONTRACT_STATES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

/** 不正状態 = 書いてはならない組み合わせ (matrix §4「不正状態」の表)。 */
export const INVALID_CONTRACT_STATES = ['X1', 'X2', 'X3', 'X4'] as const;

export type ContractState = (typeof VALID_CONTRACT_STATES)[number];
export type InvalidContractState = (typeof INVALID_CONTRACT_STATES)[number];

/** 表がまだ定義していない組み合わせ。**不正 (X*) とは区別する**。 */
export const UNCLASSIFIED_CONTRACT_STATE = 'UNCLASSIFIED';

export type ContractStateClassification =
	| ContractState
	| InvalidContractState
	| typeof UNCLASSIFIED_CONTRACT_STATE;

/** 分類対象の 4 列 (matrix §3)。`licenseStatus` は列ではなく算出値なので受け取らない。 */
export interface ContractStateColumns {
	status: string;
	plan: string | null;
	stripeSubscriptionId: string | null;
	planExpiresAt: string | Date | null;
}

/** 「あり/なし」だけが分類に効く (matrix §4 の脚注)。空文字は「なし」と同じに倒す。 */
function present(value: string | Date | null | undefined): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.length > 0;
	return true;
}

/** 分類に効く形だけに落とした 4 列。 */
interface ContractShape {
	status: string;
	hasPlan: boolean;
	hasSub: boolean;
	hasExp: boolean;
}

/**
 * 不正状態 (matrix §4「不正状態」) に当たるか。当たらなければ null。
 *
 * status 固有の不正 (X3 / X4) を先に見る。「その status では起こり得ない列」を先に落とさないと、
 * status 非依存の X1 / X2 が先に食って診断名がずれる。
 */
function findInvalid(shape: ContractShape): InvalidContractState | null {
	const { status, hasPlan, hasSub, hasExp } = shape;

	// X3: active に期限は無い。dunning / 解約の残骸 (matrix §5 D2)
	if (status === SUBSCRIPTION_STATUS.ACTIVE && hasExp) return 'X3';

	// X4: 猶予の対象となる契約が存在しない
	if (status === SUBSCRIPTION_STATUS.GRACE_PERIOD && !hasSub) return 'X4';

	// X1: 契約が無いのにプランだけ残る
	if (!hasSub && hasPlan) return 'X1';

	// X2: 課金しているのにプラン不明 → planTier が standard に丸められる
	if (hasSub && !hasPlan) return 'X2';

	return null;
}

/**
 * 正常状態 (matrix §4 の表) に当たるか。当たらなければ null (= 表が定義していない)。
 *
 * `findInvalid` を通過した時点で plan と sub は「両方あり」か「両方なし」に絞られている。
 */
function findValid(shape: ContractShape): ContractState | null {
	const { status, hasPlan, hasSub, hasExp } = shape;

	if (status === SUBSCRIPTION_STATUS.ACTIVE) {
		if (!hasPlan && !hasSub) return 'S1';
		if (hasPlan && hasSub) return 'S2';
		return null;
	}

	// S3 は exp (猶予終了日) を伴う。exp なしは表が定義していない
	if (status === SUBSCRIPTION_STATUS.GRACE_PERIOD) {
		return hasPlan && hasSub && hasExp ? 'S3' : null;
	}

	if (status === SUBSCRIPTION_STATUS.SUSPENDED) {
		// S4 の exp は「任意」
		if (hasPlan && hasSub) return 'S4';
		if (!hasPlan && !hasSub && !hasExp) return 'S5';
	}

	return null;
}

/**
 * 4 列を S1〜S6 / X1〜X4 / UNCLASSIFIED に分類する (matrix §4)。
 *
 * **判定順には意味がある**:
 *
 * 1. `terminated` (S6) を最初に見る — matrix §4 で plan / sub / exp が「任意」と定義されており、
 *    退会済みの印は 4 列の残骸が何であれ意味が変わらない。後ろに置くと X1 / X2 が先に食う。
 * 2. status 固有の不正 (X3 / X4) — 「その status では起こり得ない列」を先に落とす。
 * 3. status 非依存の不正 (X1 / X2) — plan と sub の対応が崩れている。
 * 4. 残りを正常状態に当てる。
 */
export function classifyContractState(columns: ContractStateColumns): ContractStateClassification {
	const shape = {
		status: columns.status,
		hasPlan: present(columns.plan),
		hasSub: present(columns.stripeSubscriptionId),
		hasExp: present(columns.planExpiresAt),
	};

	// S6: 退会済み。plan / sub / exp は任意 (matrix §4.1)
	if (shape.status === SUBSCRIPTION_STATUS.TERMINATED) return 'S6';

	return findInvalid(shape) ?? findValid(shape) ?? UNCLASSIFIED_CONTRACT_STATE;
}

/** 不正状態 (X*) か。`UNCLASSIFIED` は含めない (意味が違う)。 */
export function isInvalidContractState(
	classification: ContractStateClassification,
): classification is InvalidContractState {
	return (INVALID_CONTRACT_STATES as readonly string[]).includes(classification);
}
