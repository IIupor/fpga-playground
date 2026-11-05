import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

globalThis.btoa ||= value => Buffer.from(value, "binary").toString("base64");
globalThis.atob ||= value => Buffer.from(value, "base64").toString("binary");

const source = await readFile(new URL("../../sta-broker/worker.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { default: worker, createAppJwt, StaGuard, validateSignalMap, readJsonLimited, installationTokenPayload } = await import(moduleUrl);
globalThis.crypto ||= webcrypto;

for (const type of ["pkcs1", "pkcs8"]) {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type, format: "pem" }
  });

  const jwt = await createAppJwt({
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: keys.privateKey
  });
  const [headerPart, payloadPart, signaturePart] = jwt.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));

  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "123456");
  assert.ok(payload.exp > payload.iat);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(headerPart + "." + payloadPart);
  verifier.end();
  assert.equal(verifier.verify(keys.publicKey, Buffer.from(signaturePart, "base64url")), true);
}


console.log("GitHub App JWT signing works with PKCS#1 and PKCS#8 PEM keys.");


const kvStore = new Map();
const env = {
  APP_ORIGIN: "https://iiupor.github.io",
  APP_URL: "https://iiupor.github.io/fpga-playground/",
  GITHUB_REPOSITORY: "IIupor/fpga-playground",
  GITHUB_OWNER_ID: "39133075",
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  STA_BROKER_SECRET: "test-broker-secret-".repeat(3),
  STA_KV: {
    async put(key, value) { kvStore.set(key, value); },
    async get(key, type) {
      const value = kvStore.get(key) || null;
      return type === "json" && value ? JSON.parse(value) : value;
    },
    async delete(key) { kvStore.delete(key); }
  }
};
const loginResponse = await worker.fetch(new Request("https://broker.example/auth/login"), env);
assert.equal(loginResponse.status, 302);
const authorizationUrl = new URL(loginResponse.headers.get("Location"));
const oauthState = authorizationUrl.searchParams.get("state");
const stateCookie = loginResponse.headers.get("Set-Cookie");
assert.ok(oauthState);
assert.match(stateCookie, /HttpOnly/);
assert.match(stateCookie, /Secure/);
assert.match(stateCookie, /SameSite=Lax/);
assert.equal(kvStore.get("oauth-state:" + oauthState), "1");

let externalFetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  externalFetches++;
  if (String(url) === "https://github.com/login/oauth/access_token") {
    return new Response(JSON.stringify({ access_token: "test-user-token" }), { status: 200 });
  }
  if (String(url) === "https://api.github.com/user") {
    return new Response(JSON.stringify({ login: "IIupor", id: 39133075 }), { status: 200 });
  }
  throw new Error("Unexpected external request: " + url);
};
try {
  const callbackUrl = "https://broker.example/auth/callback?state=" +
    encodeURIComponent(oauthState) + "&code=authorization-code";
  const missingCookie = await worker.fetch(new Request(callbackUrl), env);
  assert.equal(missingCookie.status, 400);
  assert.equal(externalFetches, 0, "callback must reject an unbound OAuth state before exchanging the code");

  const mismatchedCookie = await worker.fetch(new Request(callbackUrl, {
    headers: { Cookie: "sta_oauth_state=attacker-controlled-state" }
  }), env);
  assert.equal(mismatchedCookie.status, 400);
  assert.equal(externalFetches, 0, "callback must reject a mismatched browser state");

  const validCallback = await worker.fetch(new Request(callbackUrl, {
    headers: { Cookie: "sta_oauth_state=" + oauthState }
  }), env);
  assert.equal(validCallback.status, 302);
  assert.match(validCallback.headers.get("Location"), /#sta_session=/);
  assert.match(validCallback.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(kvStore.has("oauth-state:" + oauthState), false);
  assert.equal([...kvStore.keys()].some(key => key.startsWith("session:")), true);
  assert.equal(externalFetches, 2);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("GitHub OAuth state is bound to the initiating browser and rejects missing or mismatched cookies.");

const jobId = crypto.randomUUID();
kvStore.set("job:" + jobId, JSON.stringify({
  id: jobId,
  status: "queued",
  input: { verilog: "module top; endmodule", top: "top", sdc: "create_clock -name core_clk -period 1" }
}));
const internalUrl = "https://broker.example/internal/jobs/" + jobId;
const missingInternalAuth = await worker.fetch(new Request(internalUrl), env);
assert.equal(missingInternalAuth.status, 401, "internal endpoints must reject requests without a broker secret");
const validInternalAuth = await worker.fetch(new Request(internalUrl, {
  headers: { Authorization: "Bearer " + env.STA_BROKER_SECRET }
}), env);
assert.equal(validInternalAuth.status, 200);
assert.equal((await validInternalAuth.json()).top, "top");

env.STA_BROKER_SECRET = "";
const emptyConfiguredSecret = await worker.fetch(new Request(internalUrl), env);
assert.equal(emptyConfiguredSecret.status, 401, "an empty configured secret must fail closed");
env.STA_BROKER_SECRET = "short";
const weakConfiguredSecret = await worker.fetch(new Request(internalUrl, {
  headers: { Authorization: "Bearer short" }
}), env);
assert.equal(weakConfiguredSecret.status, 401, "short configured secrets must fail closed");

console.log("Internal broker endpoints require a configured secret of at least 32 characters.");


const sessionEntry = [...kvStore.entries()].find(([key]) => key.startsWith("session:"));
assert.ok(sessionEntry, "successful OAuth must create a broker session");
const ownerSessionId = sessionEntry[0].slice("session:".length);
const ownerSession = JSON.parse(sessionEntry[1]);
kvStore.set("session:non-owner-session", JSON.stringify({
  login: "other-account",
  githubId: "99999999",
  expiresAt: Date.now() + 60_000
}));
const forgedOwnerRequest = await worker.fetch(new Request("https://broker.example/api/jobs", {
  method: "POST",
  headers: {
    Origin: env.APP_ORIGIN,
    "Content-Type": "application/json",
    Authorization: "Bearer non-owner-session"
  },
  body: JSON.stringify({
    verilog: "module top; endmodule",
    top: "top",
    sdc: "create_clock -name core_clk -period 1"
  })
}), env);
assert.equal(forgedOwnerRequest.status, 401, "a session with a non-owner GitHub numeric ID must not submit jobs");
assert.equal(ownerSession.githubId, "39133075");

assert.deepEqual(installationTokenPayload(1435782414), {
  repository_ids: [1435782414],
  permissions: { contents: "write" }
});
assert.throws(() => installationTokenPayload(0), /repository ID/);
assert.deepEqual(validateSignalMap({
  and_out: { nodeId: 3, wireIds: [9, 10] }
}), {
  and_out: { nodeId: 3, wireIds: [9, 10] }
});
assert.throws(() => validateSignalMap({
  bad: { nodeId: -1, wireIds: [1] }
}), /invalid mapping entry/i);
assert.throws(() => validateSignalMap({
  bad: { nodeId: 1, wireIds: Array(257).fill(1) }
}), /invalid mapping entry/i);
await assert.rejects(
  () => readJsonLimited(new Request("https://broker.example/test", {
    method: "POST",
    body: JSON.stringify({ value: "this body is too large" })
  }), 8),
  error => error.status === 413
);

const guardStore = new Map();
let guardQueue = Promise.resolve();
const guardContext = {
  storage: {
    transaction(callback) {
      const operation = guardQueue.then(() => callback({
        async get(key) {
          const value = guardStore.get(key);
          return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        },
        async put(key, value) {
          guardStore.set(key, JSON.parse(JSON.stringify(value)));
        }
      }));
      guardQueue = operation.catch(() => {});
      return operation;
    }
  }
};
const guard = new StaGuard(guardContext, {});
const guardAction = (action, jobId, status) => guard.fetch(new Request("https://guard.internal/action", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action, jobId, status })
}));
const firstJobId = crypto.randomUUID();
const secondJobId = crypto.randomUUID();
assert.equal((await guardAction("reserve", firstJobId)).status, 200);
assert.equal((await guardAction("reserve", secondJobId)).status, 409,
  "the global guard must reject a second active STA job");
assert.equal((await guardAction("claim", firstJobId)).status, 200);
assert.equal((await guardAction("claim", firstJobId)).status, 409,
  "a job may only be claimed once");
assert.equal((await guardAction("finish", firstJobId, "completed")).status, 200);
const repeatedFinish = await guardAction("finish", firstJobId, "completed");
assert.equal(repeatedFinish.status, 200, "result delivery retries must be idempotent");
assert.equal((await guardAction("reserve", secondJobId)).status, 429,
  "the cooldown must reject rapid consecutive submissions");

console.log("STA owner ID, bounded request parsing, mapping validation, token scope, and atomic job guard tests passed.");
