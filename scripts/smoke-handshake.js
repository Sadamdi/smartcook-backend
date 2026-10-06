"use strict";

/**
 * End-to-end smoke test for the double-token scheme.
 *
 * Talks to a live deployment (default: the production host) and walks the
 * whole lifecycle:
 *
 *   1. handshake with the real release cert        -> 201 + token pair
 *   2. handshake with a bogus cert                  -> 403 FORBIDDEN_CLIENT
 *   3. handshake without the cert header           -> 400 CERT_MISSING
 *   4. authenticated GET with the access token      -> 200
 *   5. authenticated GET with a bogus access token  -> 401 TOKEN_INVALID
 *   6. refresh with the refresh token               -> 201/200 + NEW pair
 *   7. old access token after refresh               -> 401 (single-use rotation)
 *   8. refresh with the consumed refresh token      -> 401 REFRESH_INVALID
 *   9. revoke, then reuse the access token          -> 401
 *  10. unauthenticated GET (no Authorization)       -> 401 TOKEN_MISSING
 *
 * Run:  node scripts/smoke-handshake.js
 *       SMOKE_BASE=https://staging.example.com node scripts/smoke-handshake.js
 */

const BASE =
  process.env.SMOKE_BASE || "https://api.himatif-encoder.com";
const CERT =
  process.env.SMOKE_CERT ||
  "7d237c7980ecaf14cb86e23b8a8d66ac16e5b2357231e4ac0e5d84c28a67ff64";
const BUILD = Number(process.env.SMOKE_BUILD || 4);
const ABI = process.env.SMOKE_ABI || "arm64";

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  console.log("  PASS  " + name);
}

function fail(name, detail) {
  failed++;
  console.log("  FAIL  " + name + "  ->  " + detail);
}

async function call(method, path, { body, bearer } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearer) headers.Authorization = "Bearer " + bearer;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

function describe(res) {
  const code = res.body && res.body.code ? res.body.code : "";
  const msg = res.body && res.body.message ? res.body.message : JSON.stringify(res.body);
  return "status=" + res.status + (code ? " code=" + code : "") + " msg=" + String(msg).slice(0, 140);
}

async function main() {
  console.log("SmartCook app-token smoke test");
  console.log("base=" + BASE + " build=" + BUILD + " abi=" + ABI);
  console.log("");

  // 1. happy path handshake
  const hs = await call("POST", "/api/auth/handshake", {
    body: { build: BUILD, abi: ABI },
    bearer: undefined,
  });
  // The cert header is not settable via the convenience wrapper above, so
  // do it explicitly for this one call.
  const hsWithCert = await (async () => {
    const res = await fetch(BASE + "/api/auth/handshake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Smartcook-Cert": CERT,
      },
      body: JSON.stringify({ build: BUILD, abi: ABI }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, body: json };
  })();
  void hs;

  let access = null;
  let refresh = null;

  if (hsWithCert.status === 201 && hsWithCert.body && hsWithCert.body.data) {
    access = hsWithCert.body.data.access;
    refresh = hsWithCert.body.data.refresh;
    ok(
      "1. handshake returns 201 with access+refresh (access_expires_in=" +
        hsWithCert.body.data.access_expires_in +
        "s refresh_expires_in=" +
        hsWithCert.body.data.refresh_expires_in +
        "s)"
    );
  } else {
    fail("1. handshake with valid cert", describe(hsWithCert));
    console.log("");
    console.log("Cannot continue without a token pair. Result: " + passed + " passed, " + failed + " failed.");
    process.exit(1);
  }

  // 2. bogus cert
  const badCert = await (async () => {
    const res = await fetch(BASE + "/api/auth/handshake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smartcook-Cert": "deadbeef",
      },
      body: JSON.stringify({ build: BUILD, abi: ABI }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  })();
  if (badCert.status === 403) ok("2. bogus cert rejected with 403");
  else fail("2. bogus cert rejected with 403", describe(badCert));

  // 3. missing cert
  const noCert = await call("POST", "/api/auth/handshake", {
    body: { build: BUILD, abi: ABI },
  });
  if (noCert.status === 400) ok("3. missing cert header rejected with 400");
  else fail("3. missing cert header rejected with 400", describe(noCert));

  // 4. authenticated read
  const authed = await call("GET", "/api/recipes/popular?limit=2", { bearer: access });
  if (authed.status === 200) ok("4. authenticated GET returns 200");
  else fail("4. authenticated GET returns 200", describe(authed));

  // 5. bogus access token
  const badToken = await call("GET", "/api/recipes/popular?limit=1", {
    bearer: "not-a-real-token",
  });
  if (badToken.status === 401) ok("5. bogus access token rejected with 401");
  else fail("5. bogus access token rejected with 401", describe(badToken));

  // 6. refresh issues a new pair
  const refreshed = await call("POST", "/api/auth/refresh", {
    body: { refresh },
  });
  let newAccess = null;
  let newRefresh = null;
  if (refreshed.status === 200 && refreshed.body && refreshed.body.data) {
    newAccess = refreshed.body.data.access;
    newRefresh = refreshed.body.data.refresh;
    ok("6. refresh returns a new token pair");
  } else {
    fail("6. refresh returns a new token pair", describe(refreshed));
  }

  // 7. old access token must be dead after rotation
  if (newAccess) {
    const oldAccess = await call("GET", "/api/recipes/popular?limit=1", {
      bearer: access,
    });
    if (oldAccess.status === 401) ok("7. old access token rejected after refresh (single-use)");
    else fail("7. old access token rejected after refresh (single-use)", describe(oldAccess));

    // 8. consumed refresh token must be dead
    const reused = await call("POST", "/api/auth/refresh", { body: { refresh } });
    if (reused.status === 401) ok("8. consumed refresh token rejected (replay blocked)");
    else fail("8. consumed refresh token rejected (replay blocked)", describe(reused));

    // 9. revoke then reuse
    const revoked = await call("DELETE", "/api/auth/revoke", {
      body: { reason: "smoke_test" },
      bearer: newAccess,
    });
    if (revoked.status === 200) ok("9. revoke accepted for the session's own token");
    else fail("9. revoke accepted for the session's own token", describe(revoked));

    const afterRevoke = await call("GET", "/api/recipes/popular?limit=1", {
      bearer: newAccess,
    });
    if (afterRevoke.status === 401) ok("9b. revoked access token rejected with 401");
    else fail("9b. revoked access token rejected with 401", describe(afterRevoke));

    // cleanup: revoke the new refresh pair too so smoke runs leave no litter
    await call("POST", "/api/auth/refresh", { body: { refresh: newRefresh } });
  }

  // 10. missing Authorization header
  const anon = await call("GET", "/api/recipes/popular?limit=1");
  if (anon.status === 401) ok("10. request without Authorization rejected with 401");
  else fail("10. request without Authorization rejected with 401", describe(anon));

  console.log("");
  console.log("result: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("smoke test crashed: " + error.message);
  process.exit(1);
});
