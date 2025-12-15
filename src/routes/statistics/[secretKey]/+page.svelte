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

	$: t = translations[currentLang as keyof typeof translations];

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

		// Get most recent entry
		const sortedData = [...logData].sort(
			(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
		);
		const latestEntry = sortedData[0];

		let currentURL = '';
		try {
			const parsedData =
				typeof latestEntry.data === 'string' ? JSON.parse(latestEntry.data) : latestEntry.data;
			currentURL = parsedData.currentURL;
		} catch (e) {
			console.error('Error parsing log data', e);
			alert(t.errorParsing);
			return;
		}

		// Remove parameters from URL
		const urlObj = new URL(currentURL);
		urlObj.search = '';
		currentURL = urlObj.toString();

		// Remove # fragment
		currentURL = currentURL.split('#')[0];

		if (!currentURL) {
			alert(t.noCurrentUrl);
			return;
		}

		console.log('Found currentURL:', currentURL);
		await main(currentURL);
	}

	async function loadData(log_type: number = 1) {
		if (!secretKey) return;
		// Handle the form submission logic here
		// console.log('Secret Key submitted:', secretKey);
		let result = await fetch(`/api/log?log_type=${log_type}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${secretKey}`
			}
		}).then((res) => res.json());

		console.log(result);
		logData = result.results || [];
		localStorage.setItem(`statistics_data_${secretKey}`, JSON.stringify(logData));

		if (logData.length > 0) {
			addToSavedProjects(secretKey, logData[0].project_id);
		} else if (log_type === 1) {
			// Try loading CSP logs if no regular logs found
			await loadData(2);
		}
	}

	function downloadData() {
		const dataStr =
			'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logData, null, 2));
		const downloadAnchorNode = document.createElement('a');
		downloadAnchorNode.setAttribute('href', dataStr);
		downloadAnchorNode.setAttribute('download', 'statistics_data.json');
		document.body.appendChild(downloadAnchorNode); // required for firefox
		downloadAnchorNode.click();
		downloadAnchorNode.remove();
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

		const storedData = localStorage.getItem(`statistics_data_${secretKey}`);
		if (storedData) {
			try {
				logData = JSON.parse(storedData);
				if (logData.length > 0) {
					addToSavedProjects(secretKey, logData[0].project_id);
				}
			} catch (e) {
				console.error('Failed to parse stored data', e);
			}
		}

		const storedProjectData = localStorage.getItem(`project_data_${secretKey}`);
		if (storedProjectData) {
			try {
				projectData = JSON.parse(storedProjectData);
			} catch (e) {
				console.error('Failed to parse stored project data', e);
			}
		}
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
			on:click={() => {
				loadData();
			}}>{t.updateStatistics}</button
		>
		<button
			class="btn-success"
			on:click={() => {
				updateProjectJson();
			}}>{t.updateProjectJson}</button
		>
		<button
			class="btn-secondary"
			on:click={() => {
				downloadData();
			}}>{t.downloadData}</button
		>
	</div>

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
