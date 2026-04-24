// src/lib/server/ai/bedrock-client.ts
// 後方互換シム (#987)
//
// 既存のサービスは `bedrock-client` から import している。
// 新しい provider/factory 層への移行が完了するまで、re-export で互換性を維持する。
// 移行完了後はこのファイルを削除可能。

// biome-ignore lint/performance/noBarrelFile: 後方互換 re-export のため維持、削除は別 Issue で検討
export { isAiAvailable as isBedrockAvailable } from './factory';
export type { ToolDefinition, ToolUseResult as BedrockToolUseResult } from './provider';

import { getAiProvider } from './factory';
import type { ToolDefinition } from './provider';

/**
 * @deprecated `getAiProvider().converseWithTool()` を直接使用してください
 */
export async function converseWithTool(opts: {
	system: string;
	userMessage: string;
	tool: ToolDefinition;
	maxTokens?: number;
}): Promise<{ toolName: string; input: Record<string, unknown> }> {
	return getAiProvider().converseWithTool(opts);
}

/**
 * @deprecated `getAiProvider().converseWithImageAndTool()` を直接使用してください
 */
export async function converseWithImageAndTool(opts: {
	system: string;
	userText: string;
	imageBase64: string;
	imageMimeType: string;
	tool: ToolDefinition;
	maxTokens?: number;
}): Promise<{ toolName: string; input: Record<string, unknown> }> {
	return getAiProvider().converseWithImageAndTool(opts);
}
