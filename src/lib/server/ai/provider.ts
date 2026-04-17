// src/lib/server/ai/provider.ts
// AI プロバイダー共通インターフェース (#987)
//
// NUC (Gemini) / AWS (Bedrock Claude) を透過的に切り替えるための抽象化レイヤー。
// 各サービス（activity-suggest, checklist-suggest, receipt-ocr, reward-suggest）は
// このインターフェースを通じて AI を呼び出す。

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ToolUseResult {
	toolName: string;
	input: Record<string, unknown>;
}

/**
 * AI プロバイダーの共通インターフェース。
 *
 * テキスト入力 → 構造化出力（tool_use / JSON）を返す。
 * プロバイダー固有の API 差異はこのインターフェースの裏に隠蔽する。
 */
export interface AiProvider {
	/** プロバイダー名（ログ用） */
	readonly name: string;

	/** AI が利用可能かどうかを判定（API キー/認証情報の有無チェック） */
	isAvailable(): boolean;

	/**
	 * テキスト入力で構造化出力を取得する。
	 * Bedrock: Converse API + tool_use
	 * Gemini: generateContent + JSON パース
	 */
	converseWithTool(opts: {
		system: string;
		userMessage: string;
		tool: ToolDefinition;
		maxTokens?: number;
	}): Promise<ToolUseResult>;

	/**
	 * 画像入力付きで構造化出力を取得する。
	 * Bedrock: Converse API + image + tool_use
	 * Gemini: generateContent + inlineData + JSON パース
	 */
	converseWithImageAndTool(opts: {
		system: string;
		userText: string;
		imageBase64: string;
		imageMimeType: string;
		tool: ToolDefinition;
		maxTokens?: number;
	}): Promise<ToolUseResult>;
}
