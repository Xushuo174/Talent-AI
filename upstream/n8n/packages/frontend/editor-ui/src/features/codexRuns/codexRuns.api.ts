import type { CodexRunsOverview, CodexRunStatus } from '@n8n/api-types';
import type { IRestApiContext } from '@n8n/rest-api-client';
import { makeRestApiRequest } from '@n8n/rest-api-client';

export async function fetchCodexRunsOverview(
	context: IRestApiContext,
	projectId: string,
	filter: { limit: number; status?: CodexRunStatus },
): Promise<CodexRunsOverview> {
	return await makeRestApiRequest(context, 'GET', `/codex-coding/${projectId}/runs`, filter);
}
