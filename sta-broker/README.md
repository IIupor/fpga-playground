# Free STA job broker

The static GitHub Pages editor cannot dispatch GitHub Actions directly without exposing a credential in public JavaScript. This small Cloudflare Worker is the authentication and job-transport layer; all synthesis and timing calculations still run on GitHub-hosted runners.

## Components

- GitHub OAuth App: signs the user in. The OAuth access token remains inside the Worker.
- Cloudflare Worker + KV: stores short-lived design submissions and results, and dispatches a GitHub `repository_dispatch` event.
- GitHub Actions: runs Yosys, ABC and OpenSTA on the free standard runner.
- Sky130 HD TT Liberty: the timing library already stored in this repository.

The browser receives only a short-lived broker session identifier. It never receives a GitHub token, App secret or workflow secret.

## One-time setup

1. Create a free Cloudflare account.
2. In Cloudflare, create a KV namespace named `STA_KV`.
3. Create a GitHub OAuth App under **GitHub → Settings → Developer settings → OAuth Apps**:
   - Homepage URL: `https://iiupor.github.io/fpga-playground/`
   - Authorization callback URL: `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/auth/callback`
   - The Worker requests only the `public_repo` scope and checks that the signed-in account has push access to this repository.
4. Install Wrangler and deploy the Worker:
   ```sh
   npm install --global wrangler
   wrangler login
   ```
5. Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the namespace ID returned by:
   ```sh
   wrangler kv namespace create STA_KV
   ```
6. From the `sta-broker` directory, set the OAuth and runner secrets:
   ```sh
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   wrangler secret put STA_BROKER_SECRET
   ```
   Use a long random value for `STA_BROKER_SECRET`. Do not commit secrets or paste them into the editor.
7. Deploy:
   ```sh
   wrangler deploy
   ```
8. In the repository's **Settings → Secrets and variables → Actions**, add:
   - `STA_BROKER_URL`: the Worker URL, for example `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev`
   - `STA_BROKER_SECRET`: the same random secret configured in the Worker.
9. Configure the editor's STA broker URL to the deployed Worker URL.

## Security and retention

- OAuth tokens are stored only in Cloudflare KV and expire after six hours.
- Design jobs and results expire after six hours.
- The Worker checks repository write permission before accepting jobs.
- The workflow receives only a random job ID in its dispatch event, then retrieves the design from the Worker over HTTPS.
- The Worker secret is required for runner-to-broker requests.
- The public repository receives no design source commits or branches.

Cloudflare's free plan has usage limits. This design does not require a paid plan, but it must stay within the current free-tier quotas.
