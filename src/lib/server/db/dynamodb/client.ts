// src/lib/server/db/dynamodb/client.ts
// DynamoDB Document Client initialization with environment-based configuration

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Table name from environment (matches CDK StorageStack output) */
export const TABLE_NAME = process.env.DYNAMODB_TABLE ?? process.env.TABLE_NAME ?? 'ganbari-quest';

/** AWS region (default: Tokyo) */
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

/** Optional endpoint for DynamoDB Local (local development) */
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;

/**
 * GSI names matching CDK StorageStack definition:
 * - GSI1: Inverted index (PK=SK, SK=PK) for reverse lookups
 * - GSI2: Custom keys (GSI2PK, GSI2SK) for category-based queries
 */
export const GSI = {
	/** Inverted index: partitionKey=SK, sortKey=PK */
	GSI1: 'GSI1',
	/** Category-based queries: partitionKey=GSI2PK, sortKey=GSI2SK */
	GSI2: 'GSI2',
} as const;

let _baseClient: DynamoDBClient | null = null;
let _docClient: DynamoDBDocumentClient | null = null;

/**
 * Get the low-level DynamoDB client.
 * Lazily initialized and cached for the process lifetime.
 */
export function getBaseClient(): DynamoDBClient {
	if (_baseClient) return _baseClient;

	const config: ConstructorParameters<typeof DynamoDBClient>[0] = {
		region: REGION,
	};

	// DynamoDB Local support for development
	if (ENDPOINT) {
		config.endpoint = ENDPOINT;
		// Local credentials (DynamoDB Local ignores these but the SDK requires them)
		config.credentials = {
			accessKeyId: 'local',
			secretAccessKey: 'local',
		};
	}

	_baseClient = new DynamoDBClient(config);
	return _baseClient;
}

/**
 * Get the DynamoDB Document Client (high-level, marshalling-aware).
 * Lazily initialized and cached for the process lifetime.
 *
 * marshallOptions:
 * - removeUndefinedValues: strip undefined fields from items before write
 * - convertClassInstanceToMap: safely handle class instances
 *
 * unmarshallOptions:
 * - wrapNumbers: false for direct number usage (not BigNumber)
 */
export function getDocClient(): DynamoDBDocumentClient {
	if (_docClient) return _docClient;

	_docClient = DynamoDBDocumentClient.from(getBaseClient(), {
		marshallOptions: {
			removeUndefinedValues: true,
			convertClassInstanceToMap: true,
		},
		unmarshallOptions: {
			wrapNumbers: false,
		},
	});

	return _docClient;
}

/**
 * Reset cached clients. Useful for testing or reconfiguration.
 */
export function resetClients(): void {
	if (_baseClient) {
		_baseClient.destroy();
	}
	_baseClient = null;
	_docClient = null;
}
