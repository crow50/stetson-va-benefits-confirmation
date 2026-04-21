const fs = require('fs');
const crypto = require('crypto');
const njwt = require('njwt');

const tokenCache = new Map();

// VA_PRIVATE_KEY env var takes precedence (required for hosted deployments).
// Falls back to VA_PRIVATE_KEY_PATH for local dev with a key file.
const privateKey = process.env.VA_PRIVATE_KEY
  ? process.env.VA_PRIVATE_KEY.replace(/\\n/g, '\n')
  : fs.readFileSync(process.env.VA_PRIVATE_KEY_PATH, 'utf8');

function buildClientAssertion(clientId, audience) {
  const now = Math.round(Date.now() / 1000);
  const claims = {
    aud: audience,
    iss: clientId,
    sub: clientId,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  };
  return njwt.create(claims, privateKey, 'RS256').compact();
}

async function getAccessToken(scope, launchIcn = null, opts = {}) {
  const tokenUrl = opts.tokenUrl || process.env.VA_TOKEN_URL;
  const clientId = opts.clientId || process.env.VA_CLIENT_ID;
  const audience = opts.audience || process.env.VA_AUDIENCE || tokenUrl;

  const now = Date.now();
  const cacheKey = `${tokenUrl}:${scope}${launchIcn ? ':' + launchIcn : ''}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && now < cached.expiresAt) return cached.token;

  const assertion = buildClientAssertion(clientId, audience);
  const params = new URLSearchParams({
    grant_type:            'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion:      assertion,
    scope,
  });
  if (launchIcn) {
    params.append('launch', Buffer.from(JSON.stringify({ patient: launchIcn })).toString('base64'));
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const err = new Error(`Token request failed: ${response.status}`);
    err.response = { data };
    throw err;
  }

  const data = await response.json();
  const token = data.access_token;
  // Cache 4.5 min (tokens last 5 min, refresh 30s early)
  tokenCache.set(cacheKey, { token, expiresAt: now + (4.5 * 60 * 1000) });
  return token;
}

module.exports = { getAccessToken };
