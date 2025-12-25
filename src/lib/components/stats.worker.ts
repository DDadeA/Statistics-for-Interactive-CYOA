/// <reference lib="webworker" />

interface WorkerInput {
	data: any;
}

const ctx: DedicatedWorkerGlobalScope = self as any;

ctx.onmessage = async (event: MessageEvent<WorkerInput>) => {};
