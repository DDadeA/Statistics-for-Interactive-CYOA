/// <reference lib="webworker" />

import type { LogEntry } from '$lib/types';

interface WorkerRequest {
	requestId: number;
	entries: LogEntry[];
}

interface WorkerResponse {
	requestId: number;
	entries?: LogEntry[];
	error?: string;
}

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const { requestId, entries } = event.data;

	try {
		const parsedEntries = entries.map((entry) => {
			let parsedData: any = {};
			try {
				parsedData = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data || {};
				if (Array.isArray(parsedData?.selectedChoices)) {
					parsedData = {
						...parsedData,
						selectedChoices: [...parsedData.selectedChoices].sort()
					};
				}
			} catch {
				parsedData = {};
			}

			return {
				...entry,
				data: null,
				parsedData,
				timestamp: new Date(entry.created_at).getTime()
			};
		});

		const response: WorkerResponse = { requestId, entries: parsedEntries };
		ctx.postMessage(response);
	} catch (error) {
		const response: WorkerResponse = {
			requestId,
			error: error instanceof Error ? error.message : String(error)
		};
		ctx.postMessage(response);
	}
};
