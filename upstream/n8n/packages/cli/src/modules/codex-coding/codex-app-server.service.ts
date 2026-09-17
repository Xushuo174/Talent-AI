import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import { OperationalError } from 'n8n-workflow';

import { CodexCodingConfig } from './codex-coding.config';

type JsonObject = Record<string, unknown>;

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface TurnWaiter {
	resolve: (value: CodexTurnResult) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
	threadId: string;
	summary: string;
	inputTokens?: number;
	outputTokens?: number;
	abortSignal?: AbortSignal;
	abortHandler?: () => void;
}

export interface CodexTurnResult {
	turnId: string;
	status: 'completed' | 'failed' | 'interrupted';
	summary: string;
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string | undefined {
	return isObject(value) && typeof value[field] === 'string' ? value[field] : undefined;
}

function numberField(value: unknown, field: string): number | undefined {
	return isObject(value) && typeof value[field] === 'number' ? value[field] : undefined;
}

function errorMessage(value: unknown): string {
	if (!isObject(value)) return 'Codex App Server returned an error';
	return typeof value.message === 'string' ? value.message : JSON.stringify(value);
}

@Service()
export class CodexAppServerService {
	private process?: ChildProcessWithoutNullStreams;

	private lines?: ReadLineInterface;

	private nextRequestId = 1;

	private readonly pending = new Map<number, PendingRequest>();

	private readonly turnWaiters = new Map<string, TurnWaiter>();

	private readonly blockedTurns = new Map<string, Error>();

	private starting?: Promise<void>;

	private initializeInfo?: { userAgent?: string; codexHome?: string; platformOs?: string };

	constructor(
		private readonly config: CodexCodingConfig,
		private readonly logger: Logger,
	) {
		this.logger = this.logger.scoped('codex-coding');
	}

	async start(): Promise<void> {
		if (this.process?.exitCode === null) return;
		if (this.starting) return await this.starting;
		this.starting = this.startProcess();
		try {
			await this.starting;
		} finally {
			this.starting = undefined;
		}
	}

	private async startProcess(): Promise<void> {
		const child = spawn(
			this.config.executable,
			['-c', 'features.goals=true', 'app-server', '--listen', 'stdio://'],
			{
				shell: false,
				windowsHide: true,
				stdio: ['pipe', 'pipe', 'pipe'],
				env: process.env,
			},
		);
		this.process = child;
		this.lines = createInterface({ input: child.stdout });
		this.lines.on('line', (line) => this.handleLine(line));
		child.stderr.on('data', (chunk: Buffer) => {
			this.logger.debug('Codex App Server stderr', { message: chunk.toString().slice(0, 2_000) });
		});
		child.once('error', (error) => this.handleExit(error));
		child.once('exit', (code, signal) => {
			this.handleExit(
				new OperationalError(`Codex App Server exited (${code ?? signal ?? 'unknown'})`),
			);
		});

		const initialized = await this.request('initialize', {
			clientInfo: { name: 'talent-ai-n8n', title: 'Talent-AI n8n', version: '1.0.0' },
			capabilities: { experimentalApi: true },
		});
		this.initializeInfo = {
			...(stringField(initialized, 'userAgent') ? { userAgent: stringField(initialized, 'userAgent') } : {}),
			...(stringField(initialized, 'codexHome') ? { codexHome: stringField(initialized, 'codexHome') } : {}),
			...(stringField(initialized, 'platformOs') ? { platformOs: stringField(initialized, 'platformOs') } : {}),
		};
		this.notify('initialized');
	}

	async health() {
		await this.start();
		return { connected: true, ...this.initializeInfo };
	}

	async shutdown(): Promise<void> {
		this.lines?.close();
		this.process?.kill();
		this.process = undefined;
	}

	async startThread(options: {
		cwd: string;
		model?: string;
	}): Promise<{ threadId: string; sessionId?: string }> {
		await this.start();
		const response = await this.request('thread/start', {
			cwd: options.cwd,
			approvalPolicy: 'never',
			sandbox: 'workspace-write',
			experimentalRawEvents: false,
			persistExtendedHistory: false,
			...(options.model ? { model: options.model } : {}),
		});
		const thread = isObject(response) && isObject(response.thread) ? response.thread : undefined;
		const threadId = stringField(thread, 'id');
		if (!threadId) throw new OperationalError('Codex App Server did not return a thread id');
		return { threadId, ...(stringField(thread, 'sessionId') ? { sessionId: stringField(thread, 'sessionId') } : {}) };
	}

	async resumeThread(threadId: string, cwd: string, model?: string): Promise<void> {
		await this.start();
		await this.request('thread/resume', {
			threadId,
			cwd,
			approvalPolicy: 'never',
			sandbox: 'workspace-write',
			excludeTurns: true,
			persistExtendedHistory: false,
			...(model ? { model } : {}),
		});
	}

	async setGoal(threadId: string, goal: string): Promise<void> {
		if (!goal.trim()) return;
		await this.request('thread/goal/set', { threadId, objective: goal.trim(), status: 'active' });
	}

	async runTurn(options: {
		threadId: string;
		cwd: string;
		task: string;
		model?: string;
		effort?: 'low' | 'medium' | 'high' | 'xhigh';
		timeoutMs: number;
		signal?: AbortSignal;
	}): Promise<CodexTurnResult> {
		await this.start();
		const response = await this.request('turn/start', {
			threadId: options.threadId,
			input: [{ type: 'text', text: options.task, text_elements: [] }],
			cwd: options.cwd,
			approvalPolicy: 'never',
			sandboxPolicy: {
				type: 'workspaceWrite',
				writableRoots: [options.cwd],
				networkAccess: false,
				excludeTmpdirEnvVar: false,
				excludeSlashTmp: false,
			},
			...(options.model ? { model: options.model } : {}),
			...(options.effort ? { effort: options.effort } : {}),
		});
		const turn = isObject(response) && isObject(response.turn) ? response.turn : undefined;
		const turnId = stringField(turn, 'id');
		if (!turnId) throw new OperationalError('Codex App Server did not return a turn id');

		return await new Promise<CodexTurnResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				void this.interrupt(options.threadId, turnId);
				const waiter = this.turnWaiters.get(turnId);
				if (waiter) this.disposeTurnWaiter(turnId, waiter);
				reject(new OperationalError('Codex turn timed out'));
			}, options.timeoutMs);
			const waiter: TurnWaiter = {
				resolve,
				reject,
				timer,
				threadId: options.threadId,
				summary: '',
			};
			this.turnWaiters.set(turnId, waiter);
			const blocked = this.blockedTurns.get(turnId);
			if (blocked) {
				this.blockedTurns.delete(turnId);
				this.disposeTurnWaiter(turnId, waiter);
				reject(blocked);
				return;
			}

			if (options.signal) {
				const onAbort = () => {
					void this.interrupt(options.threadId, turnId);
					this.disposeTurnWaiter(turnId, waiter);
					reject(new OperationalError('Codex turn was cancelled'));
				};
				waiter.abortSignal = options.signal;
				waiter.abortHandler = onAbort;
				if (options.signal.aborted) onAbort();
				else options.signal.addEventListener('abort', onAbort, { once: true });
			}
		});
	}

	async interrupt(threadId: string, turnId: string): Promise<void> {
		try {
			await this.request('turn/interrupt', { threadId, turnId }, 10_000);
		} catch (error) {
			this.logger.warn('Failed to interrupt a Codex turn', { error, threadId, turnId });
		}
	}

	private async request(method: string, params: JsonObject, timeoutMs = 30_000): Promise<unknown> {
		if (!this.process || this.process.exitCode !== null) {
			if (method === 'initialize') {
				throw new OperationalError('Codex App Server process is not running');
			}
			await this.start();
		}
		const id = this.nextRequestId++;
		return await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new OperationalError(`Codex App Server request timed out: ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ id, method, params });
		});
	}

	private notify(method: string, params?: JsonObject): void {
		this.write({ method, ...(params ? { params } : {}) });
	}

	private write(message: JsonObject): void {
		if (!this.process?.stdin.writable) {
			throw new OperationalError('Codex App Server stdin is not available');
		}
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private handleLine(line: string): void {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			this.logger.warn('Ignored invalid JSON from Codex App Server');
			return;
		}
		if (!isObject(message)) return;

		if (typeof message.id === 'number' && !message.method) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			clearTimeout(pending.timer);
			this.pending.delete(message.id);
			if (message.error !== undefined) pending.reject(new OperationalError(errorMessage(message.error)));
			else pending.resolve(message.result);
			return;
		}

		if ((typeof message.id === 'number' || typeof message.id === 'string') && typeof message.method === 'string') {
			this.rejectServerRequest(
				message.id,
				message.method,
				isObject(message.params) ? message.params : {},
			);
			return;
		}

		if (typeof message.method !== 'string' || !isObject(message.params)) return;
		this.handleNotification(message.method, message.params);
	}

	private rejectServerRequest(id: number | string, method: string, params: JsonObject): void {
		if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
			this.write({ id, result: { decision: 'cancel' } });
		} else if (method === 'applyPatchApproval' || method === 'execCommandApproval') {
			this.write({ id, result: { decision: 'denied' } });
		} else {
			this.write({ id, error: { code: -32000, message: `Unexpected Codex request: ${method}` } });
		}
		const error = new OperationalError(`Codex requested interaction while approvals are disabled: ${method}`);
		const requestedTurnId = stringField(params, 'turnId');
		if (requestedTurnId) {
			const waiter = this.turnWaiters.get(requestedTurnId);
			if (!waiter) {
				this.blockedTurns.set(requestedTurnId, error);
				return;
			}
			this.disposeTurnWaiter(requestedTurnId, waiter);
			waiter.reject(error);
			return;
		}
		for (const [turnId, waiter] of this.turnWaiters) {
			this.disposeTurnWaiter(turnId, waiter);
			waiter.reject(error);
		}
	}

	private handleNotification(method: string, params: JsonObject): void {
		const turnId = stringField(params, 'turnId');
		if (method === 'item/completed' && turnId && isObject(params.item)) {
			const waiter = this.turnWaiters.get(turnId);
			if (waiter && params.item.type === 'agentMessage' && typeof params.item.text === 'string') {
				waiter.summary = params.item.text;
			}
			return;
		}
		if (method === 'thread/tokenUsage/updated' && turnId && isObject(params.tokenUsage)) {
			const waiter = this.turnWaiters.get(turnId);
			const total = isObject(params.tokenUsage.total) ? params.tokenUsage.total : undefined;
			if (waiter && total) {
				waiter.inputTokens = numberField(total, 'inputTokens');
				waiter.outputTokens = numberField(total, 'outputTokens');
			}
			return;
		}
		if (method !== 'turn/completed' || !isObject(params.turn)) return;
		const completedTurnId = stringField(params.turn, 'id');
		if (!completedTurnId) return;
		const waiter = this.turnWaiters.get(completedTurnId);
		this.blockedTurns.delete(completedTurnId);
		if (!waiter) return;
		this.disposeTurnWaiter(completedTurnId, waiter);
		const status = stringField(params.turn, 'status');
		const normalizedStatus =
			status === 'completed' || status === 'failed' || status === 'interrupted'
				? status
				: 'failed';
		waiter.resolve({
			turnId: completedTurnId,
			status: normalizedStatus,
			summary: waiter.summary,
			...(waiter.inputTokens === undefined ? {} : { inputTokens: waiter.inputTokens }),
			...(waiter.outputTokens === undefined ? {} : { outputTokens: waiter.outputTokens }),
			...(isObject(params.turn.error)
				? { error: errorMessage(params.turn.error) }
				: {}),
		});
	}

	private handleExit(error: Error): void {
		this.process = undefined;
		this.lines?.close();
		this.blockedTurns.clear();
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}
		for (const [turnId, waiter] of this.turnWaiters) {
			this.disposeTurnWaiter(turnId, waiter);
			waiter.reject(error);
		}
	}

	private disposeTurnWaiter(turnId: string, waiter: TurnWaiter): void {
		clearTimeout(waiter.timer);
		if (waiter.abortSignal && waiter.abortHandler) {
			waiter.abortSignal.removeEventListener('abort', waiter.abortHandler);
		}
		this.turnWaiters.delete(turnId);
	}
}
