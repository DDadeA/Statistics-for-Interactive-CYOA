<script lang="ts">
	import StatisticsDashboard from '$lib/components/statisticsDashboard.svelte';
	import type { LogEntry } from '$lib/types';
	import { translations } from '$lib/translations';
	import { fetchWithProgress, finderUrl, proxyUrl } from '$lib/utils';
	import { loadAllLogs } from '$lib/logLoader';

	export let data;

	let currentLang = 'en';
	let t: typeof translations.en;
	$: t = translations[currentLang as keyof typeof translations];

	let selectedProjectId: string | null = null;
	let logData: LogEntry[] = [];
	let projectData: any = null;
	let activityData: any[] = [];

	let progressMessage = '';

	$: {
		if (selectedProjectId !== '') {
			loadData().then(async () => {
				// After loading data, fetch project path from data.projects
				const project = data.projects.find((proj) => proj.project_id === selectedProjectId);
				if (project) {
					let currentURL = project.sample_url;

					// Remove parameters from URL
					const urlObj = new URL(currentURL);
					urlObj.search = '';
					currentURL = urlObj.toString();

					// Remove # fragment
					currentURL = currentURL.split('#')[0];

					await main(currentURL);
				}
			});
		}
	}

	function setProgress(msg: string) {
		progressMessage = msg;
	}

	async function loadData() {
		if (!selectedProjectId) return;

		try {
			logData = await loadAllLogs({
				endpoint: '/admin/api/log',
				params: { project_id: selectedProjectId },
				onProgress: (loaded, pageNumber) =>
					setProgress(`${t.loadingStats} ${loaded.toLocaleString()} entries · page ${pageNumber}`),
				errorMessages: {
					unauthorized: t.invalidSecretKey,
					failed: t.loadFailed,
					invalidResponse: t.invalidResponse,
					missingCursor: t.missingCursor
				}
			});
			setProgress('');
		} catch (error) {
			console.error('Failed to load logs:', error);
			setProgress(error instanceof Error ? error.message : String(error));
			logData = [];
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
				setProgress(t.errorFetching + `(${error})`);
				throw error;
			});
		} else if (finding_data.type === 'icc') {
			console.log('Project type is ICC');
			console.log('Project data:', finding_data.project);
			project = finding_data.project;
		}

		projectData = project;
		setProgress(t.projectLoaded);
		setTimeout(() => setProgress(''), 3000);
	}

	interface GraphDataPoint {
		project_id: string;
		created_at: string;
	}
	function drawActivityGraph(
		ctx: CanvasRenderingContext2D,
		data: any[],
		canvas: HTMLCanvasElement,
		label: string
	) {
		const padding = 40;
		const width = canvas.width - 2 * padding;
		const height = canvas.height - 2 * padding;

		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (data.length === 0) {
			ctx.fillText('No data available', canvas.width / 2 - 50, canvas.height / 2);
			return;
		}

		const maxCount = Math.max(...data.map((d) => d.count));
		const barWidth = width / data.length;

		// Draw axes
		ctx.strokeStyle = '#000';
		ctx.beginPath();
		ctx.moveTo(padding, padding);
		ctx.lineTo(padding, canvas.height - padding);
		ctx.lineTo(canvas.width - padding, canvas.height - padding);
		ctx.stroke();

		// Draw bars
		ctx.fillStyle = '#4CAF50';
		data.forEach((point, index) => {
			const barHeight = (point.count / maxCount) * height;
			const x = padding + index * barWidth;
			const y = canvas.height - padding - barHeight;

			ctx.fillRect(x + 2, y, barWidth - 4, barHeight);
		});

		// Draw title
		ctx.fillStyle = '#000';
		ctx.font = 'bold 14px Arial';
		ctx.fillText(`${label} - Activity`, 10, 20);
	}

	async function loadActivityGraphData() {
		// api/log without project_id returns all projects with project_id and created_at
		const limit = 10000;
		let results: GraphDataPoint[] = (
			await fetch(`/admin/api/log?limit=${limit}`, {
				method: 'GET'
			}).then((res) => res.json())
		).results;

		// Count occurrences of project_id per day
		const counts: Record<string, number> = {};
		results.forEach((item) => {
			const dateKey = item.created_at.split('T')[0]; // Group by day
			counts[dateKey] = (counts[dateKey] || 0) + 1;
		});

		// Convert counts to array of { date, count }. key is project_id
		activityData = Object.entries(counts).map(([date, count]) => ({
			date,
			count
		}));

		const canvas = document.getElementById('activity-graph') as HTMLCanvasElement;
		if (canvas) {
			const ctx = canvas.getContext('2d');
			if (ctx) {
				const project = data.projects.find((proj) => proj.project_id === selectedProjectId);
				const projectLabel = project ? project.project_id.substring(0, 5) : 'All';
				drawActivityGraph(ctx, activityData, canvas, projectLabel);
			}
		}
	}
</script>

<div id="activity-graph-container">
	<h2>Activity Graph</h2>
	<p id="progress-message">{progressMessage}</p>
	<button on:click={loadActivityGraphData}>Load Activity Graph Data</button>
	<canvas id="activity-graph"></canvas>
</div>

<div class="project-list">
	<h2>Projects</h2>
	<p id="progress-message">{progressMessage}</p>
	<select bind:value={selectedProjectId}>
		<option value="" disabled selected>Select a project</option>
		{#each data.projects as project}
			<option value={project.project_id}>{project.project_id} - {project.sample_url}</option>
		{/each}
	</select>
</div>

<div class="container">
	<StatisticsDashboard {logData} {projectData} {currentLang} {progressMessage}
	></StatisticsDashboard>
</div>

<style>
	.container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.project-list {
		margin-bottom: 20px;
	}

	#progress-message {
		font-style: italic;
		color: #555;
		margin-top: 10px;
	}
</style>
