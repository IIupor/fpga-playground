const REPO_API = "https://api.github.com";

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

function redirect(url) {
  return Response.redirect(url, 302);
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

async function createInstallationToken(env) {
  const jwt = await createAppJwt(env);
  const installation = await github("/repos/" + env.GITHUB_REPOSITORY + "/installation", jwt);
  const token = await github("/app/installations/" + installation.id + "/access_tokens", jwt, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
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
    return redirect(target.toString());
  }

  if (path === "/auth/callback" && request.method === "GET") {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (!state || !code || !(await env.STA_KV.get("oauth-state:" + state))) {
      return new Response("Invalid or expired GitHub authorization state.", { status: 400 });
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
      return new Response("GitHub authorization failed: " + (tokenData.error_description || tokenData.error || "unknown error"), { status: 400 });
    }

    const user = await github("/user", tokenData.access_token);
    const repositoryOwner = env.GITHUB_REPOSITORY.split("/")[0];
    if (user.login.toLowerCase() !== repositoryOwner.toLowerCase()) {
      return new Response("Sign in with the repository owner account (" + repositoryOwner + ").", { status: 403 });
    }

    const sessionId = crypto.randomUUID();
    await env.STA_KV.put("session:" + sessionId, JSON.stringify({
      login: user.login,
      expiresAt: Date.now() + 6 * 60 * 60 * 1000
    }), { expirationTtl: 21600 });
    return redirect((env.APP_URL || (env.APP_ORIGIN + "/fpga-playground/")) + "#sta_session=" + encodeURIComponent(sessionId));
  }

  if (path === "/api/session" && request.method === "GET") {
    const session = await requireSession(request, env);
    return session ? json({ authenticated: true, login: session.login }, 200, env)
      : json({ authenticated: false }, 401, env);
  }

  if (path === "/api/jobs" && request.method === "POST") {
    if (request.headers.get("Origin") !== env.APP_ORIGIN) return json({ error: "Origin not allowed." }, 403, env);
    const session = await requireSession(request, env);
    if (!session) return json({ error: "GitHub sign-in required." }, 401, env);

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > 5_500_000) return json({ error: "Design payload exceeds 5.5 MB." }, 413, env);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON request." }, 400, env); }
    if (!input || typeof input.verilog !== "string" || !input.verilog.trim()) return json({ error: "Verilog source is required." }, 400, env);
    if (input.verilog.length > 5_000_000) return json({ error: "Verilog source exceeds 5 MB." }, 413, env);
    if (typeof input.top !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.top)) return json({ error: "Invalid top module name." }, 400, env);
    if (typeof input.sdc !== "string" || input.sdc.length > 64_000) return json({ error: "Valid SDC constraints (up to 64 KB) are required." }, 400, env);
    const sources = Array.isArray(input.sources) ? input.sources : [];
    if (sources.some(file => !file || typeof file.text !== "string")) return json({ error: "Invalid supplementary Verilog source." }, 400, env);
    const totalSourceBytes = input.verilog.length + sources.reduce((sum, file) => sum + file.text.length, 0);
    if (totalSourceBytes > 5_000_000) return json({ error: "Combined Verilog sources exceed 5 MB." }, 413, env);
    const analysis = ["setup", "hold", "both"].includes(input.analysis) ? input.analysis : "both";

    const id = crypto.randomUUID();
    const record = {
      id,
      owner: session.login,
      status: "queued",
      createdAt: Date.now(),
      input: {
        verilog: input.verilog,
        top: input.top,
        sdc: input.sdc,
        signalMap: input.signalMap && typeof input.signalMap === "object" ? input.signalMap : {},
        instanceMap: input.instanceMap && typeof input.instanceMap === "object" ? input.instanceMap : {},
        sources,
        analysis
      }
    };
    await env.STA_KV.put("job:" + id, JSON.stringify(record), { expirationTtl: 21600 });

    try {
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
    if (!safeEqual(auth, env.STA_BROKER_SECRET)) return json({ error: "Unauthorized." }, 401);

    const key = "job:" + internalJob[1];
    const record = await env.STA_KV.get(key, "json");
    if (!record) return json({ error: "Job not found." }, 404);

    if (request.method === "GET" && !internalJob[2]) {
      record.status = "running";
      await env.STA_KV.put(key, JSON.stringify(record), { expirationTtl: 21600 });
      return json(record.input);
    }

    if (request.method === "POST" && internalJob[2] === "result") {
      let result;
      try { result = await request.json(); } catch { return json({ error: "Invalid result JSON." }, 400); }
      record.status = result.status === "error" ? "error" : "completed";
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

export { createAppJwt };

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
