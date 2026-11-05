import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

globalThis.btoa ||= value => Buffer.from(value, "binary").toString("base64");
globalThis.atob ||= value => Buffer.from(value, "base64").toString("binary");

const source = await readFile(new URL("../../sta-broker/worker.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { default: worker, createAppJwt } = await import(moduleUrl);
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
    return new Response(JSON.stringify({ login: "IIupor" }), { status: 200 });
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

