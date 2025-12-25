<script lang="ts">
	import StatisticsDashboard from '$lib/components/statisticsDashboard.svelte';
	import type { LogEntry } from '$lib/types';
	import { translations } from '$lib/translations';
	import { fetchWithProgress, finderUrl, proxyUrl } from '$lib/utils';

	export let data;

	let currentLang = 'en';
	let t: typeof translations.en;
	$: t = translations[currentLang as keyof typeof translations];

	let selectedProjectId: string | null = null;
	let logData: LogEntry[] = [];
	let projectData: any = null;

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

		let result = await fetch(`/admin/api/log?project_id=${selectedProjectId}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json'
			}
		}).then((res) => res.json());

		console.log(result);
		logData = result.results || [];
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
				setProgress(t.errorFetching + `(${error.message})`);
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
</script>

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
