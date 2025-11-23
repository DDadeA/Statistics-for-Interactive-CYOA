<script lang="ts">
	import { onMount } from 'svelte';

	interface Project {
		projectId: string;
		secretKey: string;
		settings: any | undefined;
	}

	let projects: Project[] = [];
	let showGuideModal = false;
	let selectedProject: Project | null = null;
	let origin = '';

	onMount(() => {
		// Get from localStorage
		const storedProjects = localStorage.getItem('projects');
		if (storedProjects) {
			projects = JSON.parse(storedProjects);
		}
		origin = window.location.origin;
	});

	const updateLocalStorage = () => {
		localStorage.setItem('projects', JSON.stringify(projects));
	};

	const handleCreateNew = async () => {
		// Ask email for registration
		const email = prompt('Enter your email for project registration:');

		// Validate email format - WE HAVE TO CHECK THIS ON THE SERVER SIDE AS WELL
		if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			alert('Please enter a valid email address.');
			return;
		}

		// Fetch to registration API to create new project
		let response = await fetch(`/api/registration?email=${encodeURIComponent(email)}`, {
			method: 'GET'
		});

		// Check status
		if (!response.ok) {
			alert('Failed to create a new project. Reason: ' + (await response.text()));
			return;
		}

		alert('New project created. Please check your email for configuration details.');
		updateLocalStorage();
	};

	const handleAddExisting = () => {
		const existingSecretKey = prompt('Enter Secret Key:');

		console.log('Existing Secret Key:', existingSecretKey);
		// Update projects array accordingly
		if (existingSecretKey) {
			projects = [
				...projects,
				{ projectId: 'Unknown', secretKey: existingSecretKey, settings: undefined }
			];
		}

		updateLocalStorage();
	};

	const openGuide = (project: Project) => {
		selectedProject = project;
		showGuideModal = true;
	};

	const closeGuide = () => {
		showGuideModal = false;
		selectedProject = null;
	};
</script>

<div class="container">
	<h1>Manage Projects</h1>
	<div class="actions">
		<button onclick={handleCreateNew} class="btn primary">Create New Project</button>
		<button onclick={handleAddExisting} class="btn secondary">Add Existing Project</button>
	</div>
	<div class="project-list">
		{#each projects as project, index (project.secretKey)}
			<div class="project-card">
				<h2>Project #{index + 1}</h2>
				<div class="card-actions">
					<a href="/statistics/{project.secretKey}" class="btn link">Go to Statistics</a>
					<button onclick={() => openGuide(project)} class="btn info">Initialization Guide</button>
				</div>
			</div>
		{/each}
		{#if projects.length === 0}
			<p class="empty-msg">
				No projects registered yet. Please create a new project or add an existing one.
			</p>
		{/if}
	</div>
</div>

{#if showGuideModal && selectedProject}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={closeGuide}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Initialization Guide</h2>
			<p>
				Add the following script tag to your CYOA's <code>index.html</code> file, inside the
				<code>&lt;body&gt;</code> tag:
			</p>
			<pre>
&lt;body&gt;
  ...
  &lt;script src="{origin}/logger.js"&gt;&lt;/script&gt;
  &lt;script&gt;
    initializeLogging("{selectedProject.projectId}");
  &lt;/script&gt;
&lt;/body&gt;
            </pre>
			<div class="modal-actions">
				<button onclick={closeGuide} class="btn secondary">Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.container {
		max-width: 800px;
		margin: 0 auto;
		padding: 2rem;
		font-family: sans-serif;
	}
	h1 {
		font-size: 2rem;
		margin-bottom: 1.5rem;
		color: #333;
	}
	h2 {
		font-size: 1.25rem;
		margin-bottom: 1rem;
		color: #444;
	}
	.actions {
		margin-bottom: 2rem;
		display: flex;
		gap: 1rem;
	}
	.project-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.project-card {
		border: 1px solid #ddd;
		border-radius: 8px;
		padding: 1.5rem;
		background: #fff;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
	}
	.card-actions {
		display: flex;
		gap: 0.5rem;
	}
	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 1rem;
		text-decoration: none;
		display: inline-block;
		font-family: inherit;
	}
	.btn.primary {
		background-color: #007bff;
		color: white;
	}
	.btn.secondary {
		background-color: #6c757d;
		color: white;
	}
	.btn.link {
		background-color: #28a745;
		color: white;
	}
	.btn.info {
		background-color: #17a2b8;
		color: white;
	}
	.btn:hover {
		opacity: 0.9;
	}
	.empty-msg {
		color: #666;
		font-style: italic;
	}

	/* Modal Styles */
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
	}
	.modal {
		background: white;
		padding: 2rem;
		border-radius: 8px;
		max-width: 600px;
		width: 90%;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}
	pre {
		background: #f4f4f4;
		padding: 1rem;
		border-radius: 4px;
		overflow-x: auto;
		margin: 1rem 0;
		font-family: monospace;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
	}
</style>
