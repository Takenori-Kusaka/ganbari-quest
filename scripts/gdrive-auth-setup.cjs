// scripts/gdrive-auth-setup.js
// One-time setup to get Google Drive OAuth2 refresh token
//
// Prerequisites:
//   1. Go to https://console.cloud.google.com/
//   2. Create or select a project
//   3. Enable "Google Drive API"
//   4. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
//   5. Application type: "Desktop app"
//   6. Download the client ID and secret
//
// Usage:
//   node scripts/gdrive-auth-setup.js <CLIENT_ID> <CLIENT_SECRET>
//
// Then add these to your .env:
//   GDRIVE_CLIENT_ID=...
//   GDRIVE_CLIENT_SECRET=...
//   GDRIVE_REFRESH_TOKEN=<output from this script>
//   GDRIVE_FOLDER_ID=<create a folder in GDrive and copy its ID from URL>

const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const clientId = process.argv[2];
const clientSecret = process.argv[3];

if (!clientId || !clientSecret) {
	console.log('Usage: node scripts/gdrive-auth-setup.js <CLIENT_ID> <CLIENT_SECRET>');
	console.log('');
	console.log('Setup steps:');
	console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
	console.log('  2. Create OAuth 2.0 Client ID (Desktop app)');
	console.log('  3. Copy Client ID and Client Secret');
	console.log('  4. Run this script with those values');
	process.exit(1);
}

const REDIRECT_URI = 'http://localhost:3456/oauth2callback';
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
	access_type: 'offline',
	scope: ['https://www.googleapis.com/auth/drive.file'],
	prompt: 'consent',
});

console.log('');
console.log('=== Google Drive Auth Setup ===');
console.log('');
console.log('1. Open this URL in your browser:');
console.log('');
console.log(authUrl);
console.log('');
console.log('2. Authorize the application');
console.log('3. You will be redirected to localhost:3456 (waiting...)');
console.log('');

const server = http.createServer(async (req, res) => {
	const parsed = url.parse(req.url, true);
	if (parsed.pathname === '/oauth2callback') {
		const code = parsed.query.code;
		if (!code) {
			res.writeHead(400);
			res.end('Error: No authorization code received');
			return;
		}

		try {
			const { tokens } = await oauth2Client.getToken(code);
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<h1>認証成功！</h1><p>このウィンドウを閉じてください。</p>');

			console.log('=== Auth Success! ===');
			console.log('');
			console.log('Add these lines to your .env file:');
			console.log('');
			console.log(`GDRIVE_CLIENT_ID=${clientId}`);
			console.log(`GDRIVE_CLIENT_SECRET=${clientSecret}`);
			console.log(`GDRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
			console.log('GDRIVE_FOLDER_ID=<your-folder-id>');
			console.log('');
			console.log('To get GDRIVE_FOLDER_ID:');
			console.log('  1. Create a folder in Google Drive (e.g. "ganbari-quest-backups")');
			console.log('  2. Open the folder');
			console.log(
				'  3. Copy the ID from the URL: https://drive.google.com/drive/folders/<FOLDER_ID>',
			);
			console.log('');

			server.close();
			process.exit(0);
		} catch (err) {
			res.writeHead(500);
			res.end('Error: ' + err.message);
			console.error('Token exchange failed:', err.message);
		}
	}
});

server.listen(3456, () => {
	console.log('Listening on http://localhost:3456 for OAuth callback...');
});
