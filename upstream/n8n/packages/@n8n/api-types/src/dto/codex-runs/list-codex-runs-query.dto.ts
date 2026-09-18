import { z } from 'zod';

import { CODEX_RUN_STATUSES } from '../../codex-runs';
import { Z } from '../../zod-class';

export class ListCodexRunsQueryDto extends Z.class({
	status: z.enum(CODEX_RUN_STATUSES).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20),
}) {}
