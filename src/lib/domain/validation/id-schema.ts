// src/lib/domain/validation/id-schema.ts
// #3575: id が number → opaque branded string 化されたことに伴う zod 境界ヘルパ。
// 旧 `z.number().int().positive()` / `z.coerce.number()` の等価置換。query / body 由来の
// string と、旧クライアント互換の number の両方を受け、as* コンストラクタで branded 化する。
// 値の形式 (数値文字列 / uuid) は仮定しない (opaque 原則、ids.ts 参照)。

import { z } from 'zod';
import { asActivityId, asCategoryId, asChildId } from '$lib/domain/ids';

// number branch は旧クライアント互換入力のみ: 旧 schema (int().positive()) の検証を維持する
// (0 / 負数 / 小数の拒否は数値入力にのみ意味を持ち、opaque string には適用しない)。
const idLike = z.union([z.string().min(1), z.number().int().positive()]);

export const childIdSchema = idLike.transform((v) => asChildId(v));
export const activityIdSchema = idLike.transform((v) => asActivityId(v));
export const categoryIdSchema = idLike.transform((v) => asCategoryId(v));
/** 3 brand 軸以外の entity id (reward / template / log 等) 用 */
export const plainIdSchema = idLike.transform((v) => String(v));
