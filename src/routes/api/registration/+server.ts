import { query, getHash } from '$lib/utils';
import { isDisposableEmail } from 'disposable-email-domains-js';
import { Resend } from 'resend';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get email from query parameters
	const url = new URL(request.url);
	const email = url.searchParams.get('email');
	if (!email) {
		return new Response('Bad Request: Missing email', { status: 400 });
	}

	// Validate email format
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return new Response('Bad Request: Invalid email format', { status: 400 });
	}

	if (isDisposableEmail(email)) {
		return new Response('Bad Request: Disposable email addresses are not allowed', { status: 400 });
	}

	// Not allowed domains
	const notAllowedDomains = ['naver.com', 'daum.net', 'kakao.com'];
	if (notAllowedDomains.some((domain) => email.endsWith(`@${domain}`))) {
		return new Response('Bad Request: Unsafe email domain (privacy concerns)', { status: 400 });
	}

	// Generate project_id / secret key
	const project_id = crypto.randomUUID();
	const secret_key = crypto.randomUUID();

	const secret_key_hash = await getHash(secret_key, platform.env.pepper);

	// Store in D1
	let result = await query(
		platform,
		'INSERT INTO projects (project_id, secret_key_hash, created_at, email) VALUES (?, ?, ?, ?)',
		[project_id, secret_key_hash, new Date().toISOString(), email]
	);

	// Send email with project details
	const html = `
			<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
				<h2>Registration Successful / 등록 성공</h2>
				
				<h3>English</h3>
				<p>Here are your project details. Please keep your Secret Key safe. If you lose it, it cannot be recovered.</p>
				<ul>
					<li><strong>Project ID:</strong> ${project_id}</li>
					<li><strong>Secret Key:</strong> ${secret_key}</li>
				</ul>
				
				<p><strong>Statistics Page:</strong><br>
				<a href="${origin}/statistics/${secret_key}">${origin}/statistics/${secret_key}</a></p>
				
				<p><strong>How to Setup:</strong><br>
				Add the following script tag to your CYOA's <code>index.html</code> file, inside the <code>&lt;body&gt;</code> tag:</p>
				<pre style="background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto;">&lt;body&gt;
  ...
  &lt;script src="${origin}/logger.js"&gt;&lt;/script&gt;
  &lt;script&gt;
    initializeLogging("${project_id}");
  &lt;/script&gt;
&lt;/body&gt;</pre>

				<hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;">

				<h3>한국어</h3>
				<p>프로젝트 등록이 완료되었습니다. 키를 잃어버리면 복구할 수 없습니다.</p>
				<ul>
					<li><strong>프로젝트 ID:</strong> ${project_id}</li>
					<li><strong>비밀 키:</strong> ${secret_key}</li>
				</ul>
				
				<p><strong>통계 페이지:</strong><br>
				<a href="${origin}/statistics/${secret_key}">${origin}/statistics/${secret_key}</a></p>
				
				<p><strong>설정 방법:</strong><br>
				CYOA의 <code>index.html</code> 파일의 <code>&lt;body&gt;</code> 태그 안에 아래 스크립트를 추가하세요:</p>
				<pre style="background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto;">&lt;body&gt;
  ...
  &lt;script src="${origin}/logger.js"&gt;&lt;/script&gt;
  &lt;script&gt;
    initializeLogging("${project_id}");
  &lt;/script&gt;
&lt;/body&gt;</pre>
			</div>
			`;

	const resend = new Resend(platform.env.RESEND_API);
	const { data, error } = await resend.emails.send({
		from: platform.env.emailSender || 'onboarding@resend.dev',
		to: email,
		subject: 'Statistics for Interactive CYOA - Project Registration / 프로젝트 등록 완료',
		html: html
	});

	if (error) {
		return new Response('Internal Server Error: Failed to send email' + error.message, {
			status: 500
		});
	}

	return new Response();
}
