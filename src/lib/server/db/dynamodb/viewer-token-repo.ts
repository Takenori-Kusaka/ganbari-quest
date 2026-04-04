import type { InsertViewerTokenInput, ViewerToken } from '../types';

const NOT_IMPL = 'DynamoDB viewer-token-repo not implemented';

export async function findByTenant(_tenantId: string): Promise<ViewerToken[]> {
	throw new Error(NOT_IMPL);
}

export async function findByToken(_token: string): Promise<ViewerToken | undefined> {
	throw new Error(NOT_IMPL);
}

export async function insert(_input: InsertViewerTokenInput, _tenantId: string): Promise<ViewerToken> {
	throw new Error(NOT_IMPL);
}

export async function revoke(_id: number, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}

export async function deleteById(_id: number, _tenantId: string): Promise<void> {
	throw new Error(NOT_IMPL);
}
