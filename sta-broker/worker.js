const REPO_API = "https://api.github.com";

const MAX_JOB_BODY_BYTES = 5_500_000;
const MAX_SOURCE_BYTES = 5_000_000;
const MAX_SUPPLEMENTARY_SOURCES = 32;
const MAX_MAP_ENTRIES = 20_000;
const MAX_WIRE_IDS_PER_ENTRY = 256;
const STA_JOB_LEASE_MS = 25 * 60 * 1000;
const STA_JOB_COOLDOWN_MS = 60 * 1000;
const STA_DAILY_JOB_LIMIT = 20;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateSignalMap(value, label = "signalMap") {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error(label + " must be a plain object.");
  const entries = Object.entries(value);
  if (entries.length > MAX_MAP_ENTRIES) throw new Error(label + " contains too many entries.");
  for (const [name, item] of entries) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || !isPlainObject(item) ||
        !Number.isSafeInteger(item.nodeId) || item.nodeId < 0 ||
        !Array.isArray(item.wireIds) || item.wireIds.length > MAX_WIRE_IDS_PER_ENTRY ||
        item.wireIds.some(id => !Number.isSafeInteger(id) || id < 0)) {
      throw new Error(label + " contains an invalid mapping entry.");
    }
  }
  return value;
}

async function readJsonLimited(request, maxBytes) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error("Request body exceeds the supported size limit.");
    error.status = 413;
    throw error;
  }
  const encoding = request.headers.get("Content-Encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    const error = new Error("Compressed request bodies are not supported.");
    error.status = 415;
    throw error;
  }
  if (!request.body) throw new Error("A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      const error = new Error("Request body exceeds the supported size limit.");
      error.status = 413;
      throw error;
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Invalid JSON request.");
  }
}

async function callStaGuard(env, payload) {
  if (!env.STA_GUARD) throw new Error("STA job guard is not configured.");
  const id = env.STA_GUARD.idFromName("fpga-playground-sta-global");
  const stub = env.STA_GUARD.get(id);
  return stub.fetch("https://sta-guard.internal/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export class StaGuard {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    let input;
    try { input = await request.json(); }
    catch { return json({ error: "Invalid guard request." }, 400); }
    const { action, jobId } = input || {};
    if (!["reserve", "claim", "finish", "release"].includes(action) ||
        typeof jobId !== "string" || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      return json({ error: "Invalid guard action." }, 400);
    }

    return this.ctx.storage.transaction(async txn => {
      const now = Date.now();
      const day = Math.floor(now / 86_400_000);
      const state = await txn.get("state") || {
        day, dailyCount: 0, lastSubmitAt: 0,
        activeJobId: null, activeUntil: 0, jobs: {}
      };
      state.jobs ||= {};
      for (const [id, job] of Object.entries(state.jobs)) {
        if (!job || now - job.createdAt > 86_400_000) delete state.jobs[id];
      }

      if (action === "reserve") {
        if (state.jobs[jobId]) return json({ error: "This STA job has already been registered." }, 409);
        if (state.activeJobId && state.activeUntil > now) {
          return json({ error: "Another STA job is already running. Wait for it to finish." }, 409);
        }
        if (state.lastSubmitAt && now - state.lastSubmitAt < STA_JOB_COOLDOWN_MS) {
          return json({ error: "Please wait at least 60 seconds between STA submissions." }, 429);
        }
        if (state.day !== day) {
          state.day = day;
          state.dailyCount = 0;
        }
        if (state.dailyCount >= STA_DAILY_JOB_LIMIT) {
          return json({ error: "The daily STA job limit (20) has been reached. Try again tomorrow." }, 429);
        }
        state.dailyCount++;
        state.lastSubmitAt = now;
        state.activeJobId = jobId;
        state.activeUntil = now + STA_JOB_LEASE_MS;
        state.jobs[jobId] = { status: "queued", createdAt: now };
        await txn.put("state", state);
        return json({ accepted: true });
      }

      const job = state.jobs[jobId];
      if (!job) return json({ error: "STA job is unknown or expired." }, 404);

      if (action === "claim") {
        if (job.status !== "queued" || state.activeJobId !== jobId || state.activeUntil <= now) {
          return json({ error: "STA job is already claimed, finished, or expired." }, 409);
        }
        job.status = "running";
        await txn.put("state", state);
        return json({ accepted: true });
      }

      if (action === "finish") {
        if (job.status === "completed" || job.status === "error") {
          return json({ accepted: true, alreadyFinished: true });
        }
        if (job.status !== "running") return json({ error: "STA job was not claimed by a runner." }, 409);
        job.status = input.status === "error" ? "error" : "completed";
        job.finishedAt = now;
        if (state.activeJobId === jobId) {
          state.activeJobId = null;
          state.activeUntil = 0;
        }
        await txn.put("state", state);
        return json({ accepted: true });
      }

      if (action === "release") {
        job.status = "error";
        job.finishedAt = now;
        if (state.activeJobId === jobId) {
          state.activeJobId = null;
          state.activeUntil = 0;
        }
        await txn.put("state", state);
        return json({ accepted: true });
      }

      return json({ error: "Unsupported guard action." }, 400);
    });
  }
}

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status = 200, env = null) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (env) for (const [key, value] of Object.entries(corsHeaders(env))) headers.set(key, value);
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(url, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: url, ...headers } });
}

function clearOAuthStateCookie() {
  return { "Set-Cookie": "sta_oauth_state=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax" };
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function github(path, token, options = {}) {
  const response = await fetch(REPO_API + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "FPGA-Playground-STA",
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error("GitHub API " + response.status + ": " + body.slice(0, 500));
  return body ? JSON.parse(body) : null;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function derLength(length) {
  if (length < 128) return Uint8Array.of(length);
  const bytes = [];
  for (let value = length; value > 0; value = Math.floor(value / 256)) bytes.unshift(value & 255);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function pkcs1ToPkcs8(pkcs1) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86,
    0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00
  );
  const privateKey = concatBytes(Uint8Array.of(0x04), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithm, privateKey);
  return concatBytes(Uint8Array.of(0x30), derLength(body.length), body);
}

async function createAppJwt(env) {
  const isPkcs1 = env.GITHUB_APP_PRIVATE_KEY.includes("BEGIN RSA PRIVATE KEY");
  const pem = env.GITHUB_APP_PRIVATE_KEY
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const rawDer = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const der = isPkcs1 ? pkcs1ToPkcs8(rawDer) : rawDer;
  const key = await crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: env.GITHUB_APP_ID
  })));
  const signingInput = header + "." + payload;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + base64Url(new Uint8Array(signature));
}

function installationTokenPayload(repositoryId) {
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("Invalid GitHub repository ID.");
  }
  return {
    repository_ids: [repositoryId],
    permissions: { contents: "write" }
  };
}

async function createInstallationToken(env) {
  const jwt = await createAppJwt(env);
  const repositoryId = Number(env.GITHUB_REPOSITORY_ID);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("Configured GitHub repository ID is invalid.");
  }
  const installation = await github("/repos/" + env.GITHUB_REPOSITORY + "/installation", jwt);
  const token = await github("/app/installations/" + installation.id + "/access_tokens", jwt, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(installationTokenPayload(repositoryId))
  });
  return token.token;
}

async function getSession(request, env) {
  const match = request.headers.get("Authorization")?.match(/^Bearer\s+([A-Za-z0-9-]{20,80})$/);
  if (!match) return null;
  return await env.STA_KV.get("session:" + match[1], "json");
}

async function requireSession(request, env) {
  const session = await getSession(request, env);
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") {
    if (request.headers.get("Origin") !== env.APP_ORIGIN) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  if (path === "/auth/login" && request.method === "GET") {
    const state = crypto.randomUUID();
    await env.STA_KV.put("oauth-state:" + state, "1", { expirationTtl: 300 });
    const callback = url.origin + "/auth/callback";
    const target = new URL("https://github.com/login/oauth/authorize");
    target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    target.searchParams.set("redirect_uri", callback);
    target.searchParams.set("scope", "read:user");
    target.searchParams.set("state", state);
    return redirect(target.toString(), {
      "Set-Cookie": "sta_oauth_state=" + state + "; Path=/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax"
    });
  }

  if (path === "/auth/callback" && request.method === "GET") {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const stateCookie = request.headers.get("Cookie")?.split(";")
      .map(part => part.trim()).find(part => part.startsWith("sta_oauth_state="))
      ?.slice("sta_oauth_state=".length) || "";
    if (!state || !code || !safeEqual(state, stateCookie) || !(await env.STA_KV.get("oauth-state:" + state))) {
      return new Response("Invalid or expired GitHub authorization state.", {
        status: 400, headers: clearOAuthStateCookie()
      });
    }
    await env.STA_KV.delete("oauth-state:" + state);

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return new Response("GitHub authorization failed: " + (tokenData.error_description || tokenData.error || "unknown error"), {
        status: 400, headers: clearOAuthStateCookie()
      });
    }

    const user = await github("/user", tokenData.access_token);
    if (!env.GITHUB_OWNER_ID || String(user.id) !== String(env.GITHUB_OWNER_ID)) {
      return new Response("STA access is restricted to the configured repository owner account.", {
        status: 403, headers: clearOAuthStateCookie()
      });
    }

    const sessionId = crypto.randomUUID();
    await env.STA_KV.put("session:" + sessionId, JSON.stringify({
      login: user.login,
      githubId: String(user.id),
      expiresAt: Date.now() + 6 * 60 * 60 * 1000
    }), { expirationTtl: 21600 });
    return redirect((env.APP_URL || (env.APP_ORIGIN + "/fpga-playground/")) + "#sta_session=" + encodeURIComponent(sessionId), clearOAuthStateCookie());
  }

  if (path === "/api/session" && request.method === "GET") {
    const session = await requireSession(request, env);
    return session ? json({ authenticated: true, login: session.login }, 200, env)
      : json({ authenticated: false }, 401, env);
  }

  if (path === "/api/jobs" && request.method === "POST") {
    if (request.headers.get("Origin") !== env.APP_ORIGIN) return json({ error: "Origin not allowed." }, 403, env);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) {
      return json({ error: "Content-Type must be application/json." }, 415, env);
    }
    const session = await requireSession(request, env);
    if (!session || String(session.githubId || "") !== String(env.GITHUB_OWNER_ID || "")) {
      return json({ error: "GitHub owner sign-in required." }, 401, env);
    }

    let input;
    try { input = await readJsonLimited(request, MAX_JOB_BODY_BYTES); }
    catch (error) { return json({ error: error.message, code: error.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON" }, error.status || 400, env); }

    if (!isPlainObject(input) || typeof input.verilog !== "string" || !input.verilog.trim()) {
      return json({ error: "Verilog source is required." }, 400, env);
    }
    if (typeof input.top !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.top)) {
      return json({ error: "Invalid top module name." }, 400, env);
    }
    if (typeof input.sdc !== "string" || !input.sdc.trim() || new TextEncoder().encode(input.sdc).byteLength > 64_000) {
      return json({ error: "Valid SDC constraints (up to 64 KB) are required." }, 400, env);
    }
    const sources = input.sources === undefined ? [] : input.sources;
    if (!Array.isArray(sources) || sources.length > MAX_SUPPLEMENTARY_SOURCES ||
        sources.some(file => !isPlainObject(file) || typeof file.text !== "string" ||
          file.text.length === 0 || new TextEncoder().encode(file.text).byteLength > 1_000_000 ||
          (file.name !== undefined && (typeof file.name !== "string" || file.name.length > 256)))) {
      return json({ error: "Supplementary sources are invalid or exceed the per-file/count limits." }, 400, env);
    }
    const totalSourceBytes = new TextEncoder().encode(input.verilog).byteLength +
      sources.reduce((sum, file) => sum + new TextEncoder().encode(file.text).byteLength, 0);
    if (totalSourceBytes > MAX_SOURCE_BYTES) {
      return json({ error: "Combined Verilog sources exceed 5 MB." }, 413, env);
    }
    if (!["setup", "hold", "both", undefined].includes(input.analysis)) {
      return json({ error: "Invalid timing analysis selection." }, 400, env);
    }

    let signalMap, instanceMap;
    try {
      signalMap = validateSignalMap(input.signalMap, "signalMap");
      instanceMap = validateSignalMap(input.instanceMap, "instanceMap");
    } catch (error) {
      return json({ error: error.message }, 400, env);
    }

    const id = crypto.randomUUID();
    const reservation = await callStaGuard(env, { action: "reserve", jobId: id });
    if (!reservation.ok) {
      let detail = {};
      try { detail = await reservation.json(); } catch {}
      return json(detail, reservation.status, env);
    }

    const record = {
      id,
      owner: session.login,
      ownerId: session.githubId,
      status: "queued",
      createdAt: Date.now(),
      input: {
        verilog: input.verilog,
        top: input.top,
        sdc: input.sdc,
        signalMap,
        instanceMap,
        sources,
        analysis: input.analysis || "both"
      }
    };
    try {
      await env.STA_KV.put("job:" + id, JSON.stringify(record), { expirationTtl: 21600 });
      const installationToken = await createInstallationToken(env);
      await github("/repos/" + env.GITHUB_REPOSITORY + "/dispatches", installationToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "sta_job", client_payload: { job_id: id } })
      });
    } catch (error) {
      record.status = "error";
      record.error = error.message;
      await env.STA_KV.put("job:" + id, JSON.stringify(record), { expirationTtl: 21600 });
      await callStaGuard(env, { action: "release", jobId: id }).catch(() => {});
      return json({ error: "Could not start GitHub Actions: " + error.message }, 502, env);
    }
    return json({ jobId: id, status: "queued" }, 202, env);
  }

  const publicJob = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
  if (publicJob && request.method === "GET") {
    const session = await requireSession(request, env);
    if (!session) return json({ error: "GitHub sign-in required." }, 401, env);
    const record = await env.STA_KV.get("job:" + publicJob[1], "json");
    if (!record || record.owner !== session.login) return json({ error: "Job not found." }, 404, env);
    return json({
      jobId: record.id,
      status: record.status,
      createdAt: record.createdAt,
      error: record.error || null,
      result: record.result || null
    }, 200, env);
  }

  const internalJob = path.match(/^\/internal\/jobs\/([0-9a-f-]{36})(?:\/(result|status))?$/i);
  if (internalJob) {
    const auth = request.headers.get("Authorization")?.replace(/^Bearer\s+/, "") || "";
    const configuredSecret = env.STA_BROKER_SECRET;
    if (typeof configuredSecret !== "string" || configuredSecret.length < 32 || !safeEqual(auth, configuredSecret)) {
      return json({ error: "Unauthorized." }, 401);
    }

    const key = "job:" + internalJob[1];
    const record = await env.STA_KV.get(key, "json");
    if (!record) return json({ error: "Job not found." }, 404);

    if (request.method === "GET" && !internalJob[2]) {
      const claim = await callStaGuard(env, { action: "claim", jobId: internalJob[1] });
      if (!claim.ok) {
        let detail = {};
        try { detail = await claim.json(); } catch {}
        return json(detail, claim.status);
      }
      record.status = "running";
      await env.STA_KV.put(key, JSON.stringify(record), { expirationTtl: 21600 });
      return json(record.input);
    }

    if (request.method === "POST" && internalJob[2] === "result") {
      let result;
      try { result = await readJsonLimited(request, 1_500_000); }
      catch (error) { return json({ error: error.message }, error.status || 400); }
      if (!isPlainObject(result) || !["completed", "error"].includes(result.status)) {
        return json({ error: "Invalid STA result status." }, 400);
      }
      const finish = await callStaGuard(env, {
        action: "finish", jobId: internalJob[1], status: result.status
      });
      if (!finish.ok) {
        let detail = {};
        try { detail = await finish.json(); } catch {}
        return json(detail, finish.status);
      }
      record.status = result.status;
      record.result = result;
      record.finishedAt = Date.now();
      await env.STA_KV.put(key, JSON.stringify(record), { expirationTtl: 21600 });
      return json({ saved: true });
    }

    if (request.method === "POST" && internalJob[2] === "status") {
      let update;
      try { update = await request.json(); } catch { return json({ error: "Invalid status JSON." }, 400); }
      record.status = update.status === "error" ? "error" : "running";
      record.error = update.error || null;
      await env.STA_KV.put(key, JSON.stringify(record), { expirationTtl: 21600 });
      return json({ saved: true });
    }
  }

  return json({ error: "Not found." }, 404, env);
}

export { createAppJwt, validateSignalMap, readJsonLimited, installationTokenPayload };

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      const message = error?.message || "Internal error.";
      if (/(?:1027|1015|quota|rate.?limit|limit.{0,40}exceed|exceed.{0,40}limit)/i.test(message)) {
        return json({
          code: "FREE_TIER_LIMIT",
          error: "Cloudflare Free usage limit reached. STA is temporarily unavailable until the quota resets. No paid plan is enabled."
        }, 429, env);
      }
      return json({ error: message }, 500, env);
    }
  }
};
