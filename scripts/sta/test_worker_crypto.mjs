import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";

globalThis.btoa ||= value => Buffer.from(value, "binary").toString("base64");
globalThis.atob ||= value => Buffer.from(value, "base64").toString("binary");

const source = await readFile(new URL("../../sta-broker/worker.js", import.meta.url), "utf8");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const { createAppJwt } = await import(moduleUrl);

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

  const verifier = requireVerify();
  verifier.update(headerPart + "." + payloadPart);
  verifier.end();
  assert.equal(verifier.verify(keys.publicKey, Buffer.from(signaturePart, "base64url")), true);
}

function requireVerify() {
  const { createVerify } = require("node:crypto");
  return createVerify("RSA-SHA256");
}

console.log("GitHub App JWT signing works with PKCS#1 and PKCS#8 PEM keys.");
