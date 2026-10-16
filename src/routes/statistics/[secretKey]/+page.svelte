<script lang="ts">
	import { onMount } from 'svelte';
	import { translations } from '$lib/translations';
	import type { LogEntry } from '$lib/types';
	import StatisticsDashboard from '$lib/components/statisticsDashboard.svelte';
	import { finderUrl, proxyUrl } from '$lib/utils';

	let logData: LogEntry[] = [];
	let secretKey = '';
	let currentLang = 'en';

	// Project Data Handling
	let projectData: any = null;
	let progressMessage = '';
	let loadError = '';
	let isLoading = false;
	let parserWorker: Worker | null = null;
	let parserRequestId = 0;
	const parserRequests = new Map<
		number,
		{ resolve: (entries: LogEntry[]) => void; reject: (error: Error) => void }
	>();

	$: t = translations[currentLang as keyof typeof translations];

	interface LogPage {
		results: LogEntry[];
		hasMore: boolean;
		nextCursor: string | null;
	}

	interface ParserResponse {
		requestId: number;
		entries?: LogEntry[];
		error?: string;
	}

	function parseEntries(entries: LogEntry[]): Promise<LogEntry[]> {
		if (!parserWorker) {
			return Promise.reject(new Error(t.parserUnavailable));
		}

		const requestId = ++parserRequestId;
		return new Promise((resolve, reject) => {
			parserRequests.set(requestId, { resolve, reject });
			try {
				parserWorker?.postMessage({ requestId, entries });
			} catch (error) {
				parserRequests.delete(requestId);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	function setProgress(msg: string) {
		progressMessage = msg;
	}

	async function fetchWithProgress(
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

	async function main(projectPath: string) {
		setProgress(t.findingProject);

		let finding_data = await fetch(finderUrl + encodeURIComponent(projectPath))
			.then((response) => response.json())
			.catch((error) => {
				console.error('Error finding project.json:', error);
				setProgress(t.projectNotFound);
				throw error;
			});

		// Check if the finding_data is valid
		if (!finding_data || finding_data.type == 'Unknown') {
			setProgress(t.projectNotFound);
			console.warn('Project not found or unknown type:', finding_data);
			return;
		}

		let project = null;

		// if the type is icc_link
		if (finding_data.type === 'icc_link') {
			// fetch it
			const projectUrl = proxyUrl + finding_data.project;
			setProgress(`${t.loadingProject} ${projectUrl}... (${finding_data.message})`);

			project = await fetchWithProgress(projectUrl, (loaded, total) => {
				setProgress(`Loading project.json... ${Math.round(loaded / 1024)}KB`);
			}).catch((error) => {
				console.error('Error fetching project.json:', error);
				setProgress(t.errorFetching);
				throw error;
			});
		} else if (finding_data.type === 'icc') {
			console.log('Project type is ICC');
			console.log('Project data:', finding_data.project);
			project = finding_data.project;
		}

		projectData = project;
		localStorage.setItem(`project_data_${secretKey}`, JSON.stringify(projectData));
		setProgress(t.projectLoaded);
		setTimeout(() => setProgress(''), 3000);
	}

	async function updateProjectJson() {
		if (logData.length === 0) {
			alert(t.noStatsData);
			return;
		}

		let urlCount: { [key: string]: number } = {};

		for (const entry of logData) {
			let entryURL: string | undefined;
			try {
				const parsedData =
					entry.parsedData ??
					(typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data);
				entryURL = parsedData?.currentURL;
			} catch {
				continue;
			}
			if (typeof entryURL !== 'string' || !entryURL) continue;
			if (entryURL in urlCount) {
				urlCount[entryURL]++;
			} else {
				urlCount[entryURL] = 1;
			}
		}

		const mostCommonUrl = Object.entries(urlCount).sort((a, b) => b[1] - a[1])[0]?.[0];
		if (!mostCommonUrl) {
			alert(t.noCurrentUrl);
			return;
		}

		try {
			const urlObj = new URL(mostCommonUrl);
			urlObj.search = '';
			urlObj.hash = '';
			await main(urlObj.toString());
		} catch (error) {
			console.error('Failed to load project data from log URLs:', error);
			setProgress(t.errorFetching);
		}
	}

	async function loadData() {
		if (!secretKey || isLoading) return;

		isLoading = true;
		loadError = '';
		setProgress(t.loadingStats);
		const loadedEntries: LogEntry[] = [];
		let cursor: string | null = null;
		let pageNumber = 0;

		try {
			do {
				const params = new URLSearchParams({ limit: '1000' });
				if (cursor) params.set('cursor', cursor);

				const response = await fetch(`/api/log?${params}`, {
					headers: { Authorization: `Bearer ${secretKey}` }
				});
				if (!response.ok) {
					throw new Error(
						response.status === 401
							? t.invalidSecretKey
							: `${t.loadFailed} (HTTP ${response.status}).`
					);
				}

				const page = (await response.json()) as LogPage;
				if (!Array.isArray(page.results) || typeof page.hasMore !== 'boolean') {
					throw new Error(t.invalidResponse);
				}
				if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) {
					throw new Error(t.missingCursor);
				}

				loadedEntries.push(...(await parseEntries(page.results)));
				cursor = page.nextCursor;
				pageNumber++;
				setProgress(
					`${t.loadingStats} ${loadedEntries.length.toLocaleString()} entries · page ${pageNumber}`
				);

				if (!page.hasMore) break;
			} while (true);

			logData = loadedEntries;
			if (logData.length > 0) {
				addToSavedProjects(secretKey, logData[0].project_id);
			}
			setProgress(`${t.statsLoaded} ${logData.length.toLocaleString()} entries.`);
			setTimeout(() => setProgress(''), 5000);
		} catch (error) {
			console.error('Failed to load statistics:', error);
			loadError = error instanceof Error ? error.message : String(error);
			setProgress('');
		} finally {
			isLoading = false;
		}
	}

	function downloadData() {
		const exportEntries = logData.map(({ parsedData, timestamp, ...entry }) => ({
			...entry,
			data: JSON.stringify(parsedData ?? {})
		}));
		const blob = new Blob([JSON.stringify(exportEntries, null, 2)], {
			type: 'application/json'
		});
		const downloadUrl = URL.createObjectURL(blob);
		const downloadAnchor = document.createElement('a');
		downloadAnchor.href = downloadUrl;
		downloadAnchor.download = 'statistics_data.json';
		downloadAnchor.click();
		setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
	}

	function addToSavedProjects(secretKey: string, projectId: string) {
		const storedProjects = localStorage.getItem('projects');
		let projects: { projectId: string; secretKey: string; settings: any }[] = [];
		if (storedProjects) {
			try {
				projects = JSON.parse(storedProjects);
			} catch (e) {
				console.error('Error parsing projects from localStorage', e);
			}
		}

		// Check if already exists
		const exists = projects.some((p) => p.secretKey === secretKey);
		if (!exists) {
			projects.push({ projectId, secretKey, settings: undefined });
			localStorage.setItem('projects', JSON.stringify(projects));
		}
	}

	onMount(() => {
		// Extract secretKey from URL
		const urlParts = window.location.pathname.split('/');
		secretKey = urlParts[urlParts.length - 1];

		// Validate secretKey format (basic check)
		if (!secretKey || secretKey.length !== 36) {
			console.error('Invalid secret key format');
			return;
		}

		try {
			parserWorker = new Worker(
				new URL('../../../lib/components/stats.worker.ts', import.meta.url),
				{ type: 'module' }
			);
		} catch (error) {
			console.error('Failed to initialize the statistics parser:', error);
			loadError = t.parserUnavailable;
			return;
		}
		parserWorker.onmessage = (event: MessageEvent<ParserResponse>) => {
			const pending = parserRequests.get(event.data.requestId);
			if (!pending) return;
			parserRequests.delete(event.data.requestId);
			if (event.data.error) pending.reject(new Error(event.data.error));
			else pending.resolve(event.data.entries ?? []);
		};
		parserWorker.onerror = (event) => {
			const error = new Error(event.message || t.parserFailed);
			for (const pending of parserRequests.values()) pending.reject(error);
			parserRequests.clear();
			parserWorker?.terminate();
			parserWorker = null;
		};

		const storedProjectData = localStorage.getItem(`project_data_${secretKey}`);
		if (storedProjectData) {
			try {
				projectData = JSON.parse(storedProjectData);
			} catch (e) {
				console.error('Failed to parse stored project data', e);
			}
		}

		return () => parserWorker?.terminate();
	});
</script>

<div class="container">
	<div class="language-switcher">
		<span class="icon">🌐</span>
		<button class:active={currentLang === 'en'} on:click={() => (currentLang = 'en')}>EN</button>
		<span class="separator">|</span>
		<button class:active={currentLang === 'ko'} on:click={() => (currentLang = 'ko')}>KO</button>
	</div>
	<div class="button-group">
		<button
			class="btn-primary"
			disabled={isLoading}
			on:click={() => {
				loadData();
			}}>{isLoading ? t.loadingStats : t.updateStatistics}</button
		>
		<button
			class="btn-success"
			disabled={isLoading || logData.length === 0}
			on:click={() => {
				updateProjectJson();
			}}>{t.updateProjectJson}</button
		>
		<button
			class="btn-secondary"
			disabled={logData.length === 0}
			on:click={() => {
				downloadData();
			}}>{t.downloadData}</button
		>
	</div>
	{#if progressMessage}
		<p class="load-status" role="status" aria-live="polite">{progressMessage}</p>
	{/if}
	{#if loadError}
		<p class="load-error" role="alert">{loadError}</p>
	{/if}
	{#if logData.length > 0}
		<p class="data-coverage">
			{t.completeHistory}
			{logData.length.toLocaleString()}
			{t.loadedEntries}
		</p>
	{/if}

	<StatisticsDashboard {logData} {projectData} {currentLang} {progressMessage}
	></StatisticsDashboard>
</div>

<style>
	.container {
		font-family: sans-serif;
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px;
		position: relative;
	}
	.load-status,
	.data-coverage {
		margin: 0.75rem 0;
		color: #4b5563;
		font-size: 0.875rem;
	}
	.load-error {
		margin: 0.75rem 0;
		padding: 0.75rem 1rem;
		border-left: 4px solid #dc2626;
		background: #fef2f2;
		color: #991b1b;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.65;
	}
	.language-switcher {
		position: absolute;
		top: 20px;
		right: 20px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background-color: #f3f4f6;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		font-weight: bold;
		z-index: 10;
	}
	.language-switcher .icon {
		font-size: 1rem;
		margin-right: 0.25rem;
	}
	.language-switcher button {
		background: transparent;
		color: #9ca3af;
		padding: 0;
		border-radius: 0;
		font-weight: bold;
	}
	.language-switcher button:hover {
		background: transparent;
		color: #6b7280;
	}
	.language-switcher button.active {
		color: #3b82f6;
	}
	.language-switcher .separator {
		color: #d1d5db;
	}
	.button-group {
		display: flex;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	button {
		padding: 0.5rem 1rem;
		border-radius: 0.25rem;
		border: none;
		color: white;
		font-weight: bold;
		cursor: pointer;
	}
	.btn-primary {
		background-color: #3b82f6;
	}
	.btn-primary:hover {
		background-color: #1d4ed8;
	}
	.btn-success {
		background-color: #22c55e;
	}
	.btn-success:hover {
		background-color: #15803d;
	}
	.btn-secondary {
		background-color: #6b7280;
	}
	.btn-secondary:hover {
		background-color: #4b5563;
	}
</style>
