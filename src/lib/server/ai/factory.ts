// src/lib/server/ai/factory.ts
// AI プロバイダーファクトリー (#987)
//
// 環境変数 `AI_PROVIDER` に応じて適切なプロバイダーを返す。
//   - 'bedrock' (default): AWS Bedrock Claude — Lambda 環境向け
//   - 'gemini': Gemini API — NUC 環境向け
//
// サービス層は `getAiProvider()` を通じてプロバイダーを取得し、
// 環境差異を意識せずに AI 機能を利用できる。

import { BedrockClaudeProvider } from './bedrock-claude-provider';
import { GeminiProvider } from './gemini-provider';
import type { AiProvider } from './provider';

type ProviderType = 'bedrock' | 'gemini';

const providers: Record<ProviderType, AiProvider> = {
	bedrock: new BedrockClaudeProvider(),
	gemini: new GeminiProvider(),
};

/**
 * 環境設定に基づいた AI プロバイダーを返す。
 *
 * 判定順:
 * 1. `AI_PROVIDER` 環境変数が明示されていればそれを使う
 * 2. 未指定の場合は 'bedrock' (Lambda デフォルト)
 */
export function getAiProvider(): AiProvider {
	const env = process.env.AI_PROVIDER as ProviderType | undefined;
	const type: ProviderType = env === 'gemini' ? 'gemini' : 'bedrock';
	return providers[type];
}

/**
 * AI が利用可能かを判定するヘルパー。
 * 各サービスの `isBedrockAvailable()` 呼び出しを置き換える。
 */
export function isAiAvailable(): boolean {
	return getAiProvider().isAvailable();
}
