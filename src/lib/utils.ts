export const finderUrl = 'https://icc-project-finder.aseli4488.workers.dev/?path=';
export const proxyUrl = 'https://cloudflare-cors-anywhere.aseli4488.workers.dev/?';

export const getHash = async (secret_key: string, pepper: string) => {
	// Ensure secret_key is a string
	if (typeof secret_key !== 'string') {
		throw new Error('Secret key must be a string');
	}

	// Ensure pepper is defined
	if (!pepper) {
		throw new Error('Pepper is not defined in environment variables');
	}

	// Append pepper to the secret key before hashing
	secret_key = secret_key + pepper;

	return await crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(secret_key))
		.then((hashBuffer) => {
			return Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		});
};

export async function fetchWithProgress(
	url: string,
	onProgress: (loaded: number, total: number) => void
) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

	const contentLength = response.headers.get('content-length');
	const total = contentLength ? parseInt(contentLength, 10) : 0;
	let loaded = 0;

	const reader = response.body?.getReader();
	const chunks = [];

	if (reader) {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			loaded += value.length;
			if (onProgress) onProgress(loaded, total);
		}
		const blob = new Blob(chunks);
		return JSON.parse(await blob.text());
	} else {
		return response.json();
	}
}

export class ProcessingData {
	hasProgress: boolean;
	progressMessage: string;
	totalSteps: number;
	currentStep: number;

	constructor(hasProgress = false, progressMessage = '', totalSteps = 0, currentStep = 0) {
		this.hasProgress = hasProgress;
		this.progressMessage = progressMessage;
		this.totalSteps = totalSteps;
		this.currentStep = currentStep;
	}
}

export const query = async (platform: App.Platform, query: string, params?: any[]) => {
	// @ts-ignore
	const DB = platform.env.DB;
	const statement = DB.prepare(query).bind(...(params || []));
	const result = await statement.all();

	return result;
};
