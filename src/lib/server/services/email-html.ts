// src/lib/server/services/email-html.ts (#4566)
//
// 送信 HTML メールの組み立てを「素の string を本文へ入れられない」形に閉じる。
//
// ## なぜ型で閉じるか
// 元の実装は `wrapTemplate(`... ${tenantName} ...`)` のように、顧客が自由入力する値
// (テナント名 / 表示名) を無エスケープで HTML に埋めていた。escape ヘルパを 1 つ足して
// 「呼ぶ側が忘れないようにする」だけでは、同じ欠陥が次のメールで再発する
// (実際 #4507 が同じ形でメール文面を 3 通追加し、class として拡大した)。
//
// そこで **エスケープ済みであることを型で表す** (`HtmlSafe`)。`wrapTemplate` 等の本文
// 組み立て関数は `HtmlSafe` しか受け取らないため、素の string を渡すと **tsc / svelte-check
// が落ちる**。エスケープの有無を人の注意ではなく型検査に委ねる (ADR-0061 原則 2)。
//
// `HtmlSafe` は branded string ではなく **class** にしてある。branded type は実行時に消えるため
// `html` タグ側が「この値はエスケープ済みか」を判別できず、断片の合成 (行の組み立て → 表への
// 埋め込み) で二重エスケープするしかなくなるためである。
//
// **constructor は private**。生成経路は本 module の `escapeHtml` / `html` / `joinHtml` の
// 3 つだけで、「生の string を `HtmlSafe` に見せかけて本文へ入れる」逃げ道を持たない
// (逃げ道を 1 つ用意すると、急ぐ日にそこが使われて lock が形骸化する)。

const ESCAPE_PATTERN = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

/** エスケープ済み、またはコード側が組み立てた安全な HTML 断片。 */
export class HtmlSafe {
	private constructor(private readonly value: string) {}

	/** 埋め込み時の生文字列。テンプレートリテラル内では toString() 経由でこちらが使われる。 */
	get raw(): string {
		return this.value;
	}

	toString(): string {
		return this.value;
	}

	/**
	 * 任意の値を HTML エスケープする。`null` / `undefined` は空文字にする
	 * (メール本文に "undefined" が出る事故を防ぐ)。
	 */
	static escape(value: unknown): HtmlSafe {
		if (value === null || value === undefined) return new HtmlSafe('');
		return new HtmlSafe(String(value).replace(ESCAPE_PATTERN, (c) => ESCAPE_MAP[c] ?? c));
	}

	/**
	 * HTML 組み立て用のタグ付きテンプレート。
	 * 埋め込み値は **既に `HtmlSafe` のものを除き全てエスケープ**される。
	 */
	static template(strings: TemplateStringsArray, ...values: unknown[]): HtmlSafe {
		let out = strings[0] ?? '';
		for (let i = 0; i < values.length; i++) {
			const value = values[i];
			out +=
				(value instanceof HtmlSafe ? value.raw : HtmlSafe.escape(value).raw) +
				(strings[i + 1] ?? '');
		}
		return new HtmlSafe(out);
	}

	/** `HtmlSafe` の配列を連結する (行の組み立て → 表への埋め込み)。 */
	static joinAll(parts: HtmlSafe[], separator: string): HtmlSafe {
		return new HtmlSafe(parts.map((p) => p.raw).join(separator));
	}
}

/** 任意の値を HTML エスケープする。 */
export function escapeHtml(value: unknown): HtmlSafe {
	return HtmlSafe.escape(value);
}

/**
 * HTML 組み立て用のタグ付きテンプレート。埋め込み値は自動でエスケープされる。
 *
 * ```ts
 * html`<p>家族グループ「${tenantName}」</p>`   // tenantName は自動でエスケープされる
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HtmlSafe {
	return HtmlSafe.template(strings, ...values);
}

/** `HtmlSafe` の配列を連結する。 */
export function joinHtml(parts: HtmlSafe[], separator = ''): HtmlSafe {
	return HtmlSafe.joinAll(parts, separator);
}

/** 本文なしを表す `HtmlSafe` (条件付きブロックの else 側)。 */
export const EMPTY_HTML: HtmlSafe = escapeHtml('');
