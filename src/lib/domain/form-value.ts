// src/lib/domain/form-value.ts
// #3575: id が number → opaque string 化されたことに伴う form 境界ヘルパ。
// 旧コードの `Number(formData.get('x'))` は File / null を NaN に落として guard で弾いていた。
// 等価の失敗挙動を保つため、File / null は '' (空文字 = invalid) に落とし、
// 呼び出し側の空文字 guard (旧 Number.isNaN guard の等価置換) で fail させる。

export const formIdString = (v: FormDataEntryValue | null): string =>
	typeof v === 'string' ? v : '';
