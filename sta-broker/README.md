# Free STA job broker

The static GitHub Pages editor cannot dispatch GitHub Actions directly without exposing a credential in public JavaScript. This small Cloudflare Worker is the authentication and job-transport layer; all synthesis and timing calculations still run on GitHub-hosted runners.

## Components

- GitHub App: authenticates the repository owner and grants the Worker a repository-scoped installation token.
- Cloudflare Worker + KV: stores short-lived design submissions and results, and dispatches a GitHub `repository_dispatch` event.
- Cloudflare SQLite Durable Object: atomically reserves one STA job at a time, enforces cooldown/daily limits, and prevents duplicate runner claims.
- GitHub Actions: runs Yosys, ABC and OpenSTA on the free standard runner.
- Sky130 HD TT Liberty: the timing library already stored in this repository.

The browser receives only a short-lived broker session identifier. The user's GitHub token and the GitHub App private key never reach public JavaScript. The Worker uses a GitHub App installation token explicitly scoped to this repository ID and to `Contents: write` only. OAuth authorization is checked against the immutable GitHub numeric owner ID (`GITHUB_OWNER_ID`), not a changeable login name. The GitHub App token is scoped using the configured immutable repository ID (`GITHUB_REPOSITORY_ID`). Both IDs are non-secret deployment configuration values.

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

- The Worker requests only the GitHub profile scope (`read:user`) and accepts sign-in only when the OAuth user's immutable numeric ID matches `GITHUB_OWNER_ID`.
- GitHub App installation tokens are created on demand with `Contents: write` only and explicitly scoped to the repository's numeric ID.
- The SQLite-backed Durable Object serializes job reservations and runner claims. It allows one active job, enforces a 60-second submission cooldown and a maximum of 20 submissions per UTC day, and rejects duplicate claims/results.
- A runner lease expires after 25 minutes if a workflow disappears unexpectedly. The workflow timeout is 20 minutes.
- The Worker reads request bodies as a bounded stream (5.5 MB maximum), rather than trusting the optional `Content-Length` header. It also limits supplementary source count/size, validates mapping object shapes and bounds result payloads.
- Broker sessions expire after six hours; the user's OAuth token is not stored in the session record.
- Design jobs and results expire after six hours in KV; the Durable Object keeps only a bounded 24-hour job history.
- The workflow receives only a random job ID in its dispatch event, then retrieves the design from the Worker over HTTPS. Duplicate workflow runs cannot claim or execute the same job twice.
- The Worker secret is required for runner-to-broker requests.
- The public repository receives no design source commits or branches.
- User-submitted netlists and reports are not uploaded as public GitHub Actions artifacts; the result is returned to the authenticated broker session. User-job logs also suppress design-specific report text.

Cloudflare's free plan has usage limits. This design uses SQLite-backed Durable Objects, available on the Workers Free plan. If an included quota is exhausted, the affected operation fails closed; no paid plan or paid fallback is enabled.
