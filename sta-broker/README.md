# Free STA job broker

The static GitHub Pages editor cannot dispatch GitHub Actions directly without exposing a credential in public JavaScript. This small Cloudflare Worker is the authentication and job-transport layer; all synthesis and timing calculations still run on GitHub-hosted runners.

## Components

- GitHub App: authenticates the repository owner and grants the Worker a repository-scoped installation token.
- Cloudflare Worker + KV: stores short-lived design submissions and results, and dispatches a GitHub `repository_dispatch` event.
- Cloudflare SQLite Durable Object: atomically reserves one STA job at a time, enforces cooldown/daily limits, and prevents duplicate runner claims.
- GitHub Actions: runs Yosys, ABC and OpenSTA on the free standard runner.
- Sky130 HD TT Liberty: the timing library already stored in this repository.

The browser receives only a short-lived broker session identifier. The user's GitHub token and the GitHub App private key never reach public JavaScript. The Worker uses a GitHub App installation token explicitly scoped to this repository ID and to `Contents: write` only. OAuth authorization is checked against the immutable GitHub numeric owner ID (`GITHUB_OWNER_ID`), not a changeable login name.

This first implementation is **pre-layout STA**: it uses Sky130 HD TT Liberty cell timing, but does not yet extract routed interconnect parasitics from SPEF.

The runner accepts only the editor-generated SDC subset: `create_clock`, `set_input_delay`, `set_input_transition`, `set_output_delay` and `set_load`. Arbitrary Tcl commands are rejected before OpenSTA starts. The Actions workflow uses read-only repository permissions and disables persisted checkout credentials; the broker secret is exposed only to the steps that fetch a job or return its result.


## One-time setup

1. Create a free Cloudflare account.
2. In Cloudflare, create a KV namespace named `STA_KV`. The SQLite-backed `StaGuard` Durable Object is provisioned by the Wrangler migration in this repository; it is available on Cloudflare Workers Free.
3. Create a GitHub App under **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**:
   - Homepage URL: `https://iiupor.github.io/fpga-playground/`
   - Enable user authorization (OAuth) and set the callback URL to `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/auth/callback`.
   - Repository permissions: **Contents → Read and write**.
   - Install the app on **IIupor/fpga-playground only**.
   - Generate a private key and keep the downloaded PEM file private.
4. Install Wrangler and deploy the Worker:
   ```sh
   npm install --global wrangler
   wrangler login
   ```
5. Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the namespace ID returned by:
   ```sh
   wrangler kv namespace create STA_KV
   ```
6. From the `sta-broker` directory, set the GitHub App and runner secrets:
   ```sh
   wrangler secret put GITHUB_APP_ID
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   wrangler secret put GITHUB_APP_PRIVATE_KEY
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

- The Worker requests only the GitHub profile scope (`read:user`) and accepts sign-in only from the repository owner account.
- GitHub App installation tokens are created on demand with Contents write permission, scoped to this repository.
- Broker sessions expire after six hours; the user's OAuth token is not stored in the session record.
- Design jobs and results expire after six hours.
- The workflow receives only a random job ID in its dispatch event, then retrieves the design from the Worker over HTTPS.
- The Worker secret is required for runner-to-broker requests.
- The public repository receives no design source commits or branches.
- User-submitted netlists and reports are not uploaded as public GitHub Actions artifacts; the result is returned to the authenticated broker session. User-job logs also suppress design-specific report text.

Cloudflare's free plan has usage limits. This design does not require a paid plan, but it must stay within the current free-tier quotas. The Durable Object uses SQLite storage on the Free plan; exceeding an included limit causes the affected operation to fail rather than switching to paid usage.
