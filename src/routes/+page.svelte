<script lang="ts">
	import { onMount } from 'svelte';

	interface Project {
		projectId: string;
		secretKey: string;
		settings: any | undefined;
	}

	let projects: Project[] = [];
	let showGuideModal = false;
	let showCreateModal = false;
	let selectedProject: Project | null = null;
	let origin = '';

	let totalCount = 0;
	let newProjectEmail = '';
	let isCreating = false;

	onMount(async () => {
		// Get from localStorage
		const storedProjects = localStorage.getItem('projects');
		if (storedProjects) {
			projects = JSON.parse(storedProjects);
		}
		origin = window.location.origin;

		// Fetch global count
		try {
			const res = await fetch('/api/count');
			if (res.ok) {
				const data = await res.json();
				totalCount = data.count;
			}
		} catch (e) {
			console.error('Failed to fetch count', e);
		}
	});

	const updateLocalStorage = () => {
		localStorage.setItem('projects', JSON.stringify(projects));
	};

	const openCreateModal = () => {
		newProjectEmail = '';
		showCreateModal = true;
	};

	const closeCreateModal = () => {
		showCreateModal = false;
	};

	const submitCreateProject = async () => {
		if (!newProjectEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newProjectEmail)) {
			alert('Please enter a valid email address.');
			return;
		}

		isCreating = true;
		try {
			let response = await fetch(`/api/registration?email=${encodeURIComponent(newProjectEmail)}`, {
				method: 'GET'
			});

			if (!response.ok) {
				alert('Failed to create a new project. Reason: ' + (await response.text()));
				return;
			}

			alert('New project created. Please check your email for configuration details.');
			closeCreateModal();
			updateLocalStorage();
		} catch (e) {
			alert('Error creating project: ' + e);
		} finally {
			isCreating = false;
		}
	};

	const handleAddExisting = () => {
		const existingSecretKey = prompt('Enter Secret Key:');

		console.log('Existing Secret Key:', existingSecretKey);
		if (existingSecretKey) {
			projects = [
				...projects,
				{ projectId: 'Unknown', secretKey: existingSecretKey, settings: undefined }
			];
			updateLocalStorage();
		}
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

<div class="page-wrapper">
	<section class="hero">
		<div class="hero-content">
			<h1 class="title">
				Simple Statistic Services for Interactive CYOA <span class="acronym">(SSSIC)</span>
			</h1>
			<p class="subtitle">Empower your interactive stories with real-time analytics.</p>

			<div class="stat-container">
				<div class="stat-value">{totalCount.toLocaleString()}</div>
				<div class="stat-label">Total Play History Recorded</div>
			</div>

			<div class="hero-actions">
				<button onclick={openCreateModal} class="btn primary large">New Project</button>
				<button onclick={handleAddExisting} class="btn secondary large">Add Existing Project</button
				>
			</div>
		</div>
	</section>

	<main class="container">
		<h2 class="section-header">Your Projects</h2>
		<div class="project-list">
			{#each projects as project, index (project.secretKey)}
				<div class="project-card">
					<div class="card-info">
						<h3>Project #{index + 1}</h3>
						<span class="project-meta">Key: {project.secretKey.substring(0, 8)}...</span>
					</div>
					<div class="card-actions">
						<a href="/statistics/{project.secretKey}" class="btn link">Go to Statistics</a>
						<button onclick={() => openGuide(project)} class="btn info">Initialization Guide</button
						>
					</div>
				</div>
			{/each}
			{#if projects.length === 0}
				<div class="empty-state">
					<p>No projects registered locally.</p>
					<p class="empty-sub">Create a new project or add an existing one to start tracking.</p>
				</div>
			{/if}
		</div>
	</main>
</div>

{#if showCreateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={closeCreateModal}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h2>Create New Project</h2>
			<p class="modal-desc">Enter your email address to receive your project Secret Key.</p>

			<div class="input-group">
				<input
					type="email"
					bind:value={newProjectEmail}
					placeholder="your-email@example.com"
					class="text-input"
					onkeydown={(e) => e.key === 'Enter' && submitCreateProject()}
				/>
			</div>

			<div class="modal-actions">
				<button onclick={closeCreateModal} class="btn text">Cancel</button>
				<button onclick={submitCreateProject} class="btn primary" disabled={isCreating}>
					{isCreating ? 'Creating...' : 'Create Project'}
				</button>
			</div>
		</div>
	</div>
{/if}

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
	:global(body) {
		margin: 0;
		font-family:
			'Inter',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			Oxygen,
			Ubuntu,
			Cantarell,
			'Open Sans',
			'Helvetica Neue',
			sans-serif;
		background-color: #f8f9fa;
		color: #333;
	}

	.page-wrapper {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	/* Hero Section */
	.hero {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 4rem 2rem;
		text-align: center;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
	}

	.hero-content {
		max-width: 900px;
		margin: 0 auto;
	}

	.title {
		font-size: 2.5rem;
		font-weight: 800;
		margin: 0 0 0.5rem 0;
		line-height: 1.2;
	}

	.acronym {
		opacity: 0.8;
		font-weight: 400;
	}

	.subtitle {
		font-size: 1.2rem;
		opacity: 0.9;
		margin-bottom: 3rem;
	}

	.stat-container {
		margin: 3rem 0;
		padding: 2rem;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 16px;
		backdrop-filter: blur(10px);
		display: inline-block;
		min-width: 300px;
	}

	.stat-value {
		font-size: 5rem;
		font-weight: 900;
		line-height: 1;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
	}

	.stat-label {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 2px;
		opacity: 0.8;
		margin-top: 0.5rem;
	}

	.hero-actions {
		display: flex;
		gap: 1rem;
		justify-content: center;
		margin-top: 2rem;
	}

	/* Main Content */
	.container {
		max-width: 900px;
		margin: -2rem auto 2rem;
		padding: 0 2rem;
		position: relative;
		z-index: 10;
		width: 100%;
		box-sizing: border-box;
	}

	.section-header {
		font-size: 1.5rem;
		margin-bottom: 1.5rem;
		color: #444;
		padding-left: 0.5rem;
		border-left: 4px solid #764ba2;
	}

	.project-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.project-card {
		background: white;
		border-radius: 12px;
		padding: 1.5rem 2rem;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
		display: flex;
		justify-content: space-between;
		align-items: center;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.project-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 15px rgba(0, 0, 0, 0.1);
	}

	.card-info h3 {
		margin: 0 0 0.25rem 0;
		font-size: 1.25rem;
		color: #2d3748;
	}

	.project-meta {
		font-size: 0.875rem;
		color: #718096;
		font-family: monospace;
	}

	.card-actions {
		display: flex;
		gap: 0.75rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: white;
		border-radius: 12px;
		border: 2px dashed #e2e8f0;
		color: #a0aec0;
	}

	.empty-sub {
		font-size: 0.9rem;
		margin-top: 0.5rem;
	}

	/* Buttons */
	.btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.btn.large {
		padding: 1rem 2rem;
		font-size: 1.1rem;
	}

	.btn.primary {
		background-color: #fff;
		color: #764ba2;
	}

	.btn.primary:hover {
		background-color: #f0f0f0;
		transform: translateY(-1px);
	}

	/* In modal, primary button should be colored */
	.modal .btn.primary {
		background-color: #764ba2;
		color: white;
	}
	.modal .btn.primary:hover {
		background-color: #673ab7;
	}

	.btn.secondary {
		background-color: rgba(255, 255, 255, 0.2);
		color: white;
		backdrop-filter: blur(5px);
	}

	.btn.secondary:hover {
		background-color: rgba(255, 255, 255, 0.3);
	}

	/* Secondary button in light context */
	.modal .btn.secondary {
		background-color: #e2e8f0;
		color: #4a5568;
	}
	.modal .btn.secondary:hover {
		background-color: #cbd5e0;
	}

	.btn.link {
		background-color: #48bb78;
		color: white;
	}
	.btn.link:hover {
		background-color: #38a169;
	}

	.btn.info {
		background-color: #4299e1;
		color: white;
	}
	.btn.info:hover {
		background-color: #3182ce;
	}

	.btn.text {
		background: none;
		color: #718096;
	}
	.btn.text:hover {
		color: #4a5568;
		background-color: #f7fafc;
	}

	/* Modal */
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		justify-content: center;
		align-items: center;
		z-index: 1000;
		animation: fadeIn 0.2s ease-out;
	}

	.modal {
		background: white;
		padding: 2.5rem;
		border-radius: 16px;
		max-width: 500px;
		width: 90%;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.1),
			0 10px 10px -5px rgba(0, 0, 0, 0.04);
		animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.modal h2 {
		margin-top: 0;
		color: #2d3748;
	}

	.modal-desc {
		color: #718096;
		margin-bottom: 1.5rem;
	}

	.input-group {
		margin-bottom: 2rem;
	}

	.text-input {
		width: 100%;
		padding: 0.75rem 1rem;
		border: 2px solid #e2e8f0;
		border-radius: 8px;
		font-size: 1rem;
		transition: border-color 0.2s;
		box-sizing: border-box;
	}

	.text-input:focus {
		outline: none;
		border-color: #764ba2;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
	}

	pre {
		background: #f7fafc;
		padding: 1rem;
		border-radius: 8px;
		overflow-x: auto;
		margin: 1rem 0;
		font-family: 'Fira Code', monospace;
		border: 1px solid #e2e8f0;
		font-size: 0.9rem;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
