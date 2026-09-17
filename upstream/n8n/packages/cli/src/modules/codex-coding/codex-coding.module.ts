import type { ModuleInterface } from '@n8n/decorators';
import { BackendModule, OnShutdown } from '@n8n/decorators';
import { Container } from '@n8n/di';

@BackendModule({ name: 'codex-coding', instanceTypes: ['main'] })
export class CodexCodingModule implements ModuleInterface {
	async init() {
		await import('./codex-coding.controller.js');
	}

	@OnShutdown()
	async shutdown() {
		const { CodexCodingService } = await import('./codex-coding.service.js');
		await Container.get(CodexCodingService).shutdown();
	}

	async entities() {
		const { CodexCodingRun } = await import('./database/codex-coding-run.entity.js');
		const { CodexCodingTurn } = await import('./database/codex-coding-turn.entity.js');
		return [CodexCodingRun, CodexCodingTurn];
	}

	async context() {
		const { CodexCodingService } = await import('./codex-coding.service.js');
		return { codexCodingProxy: Container.get(CodexCodingService) };
	}
}
