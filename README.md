# VA Benefits Confirmation

A Node.js web app that integrates with the [VA Lighthouse API](https://developer.va.gov/) to verify veteran status and surface benefit eligibility information for use in Stetson University's admissions and Veterans Services workflow.

## Features

- **Guest lookup** - verify veteran status, disability rating, P&T / TDIU status, Chapter 33 / 31 eligibility, active benefits, and eligible VA letters without signing in
- **Dependent lookup** - check sponsor veteran status and Chapter 35 (DEA) eligibility
- **Student portal** - simulated login (future: Stetson SSO), personalized dashboard, VA Forms and resource links, one-click "Send to VS Office" for benefit letters
- Three separate VA CCG API clients: veteran verification, letter generator, education benefits

## Local Setup

**Prerequisites:** Node 20+, an RSA key pair registered with VA Lighthouse sandbox

```bash
git clone <repo>
cd va-benefits-confirmation
npm install
cp .env.example .env   # fill in your values
# place your private key at keys/private.pem
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See [.env.example](.env.example) for the full list. Required variables:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random secret for session signing |
| `VA_PRIVATE_KEY` | Full RSA private key PEM (for hosted deploys) |
| `VA_PRIVATE_KEY_PATH` | Path to PEM file (local dev alternative to above) |
| `VA_CLIENT_ID` | CCG client ID - veteran verification |
| `VA_LETTER_CLIENT_ID` | CCG client ID - letter generator |
| `VA_EDUCATION_BENEFITS_CLIENT_ID` | CCG client ID - education benefits |

All token URLs, audience URLs, and API base URLs are also required - see `.env.example`.

## Deploying to DigitalOcean App Platform

1. Push the repo to GitHub (`.env` and `keys/` are gitignored and never committed)
2. In DigitalOcean: **Create App** → connect the GitHub repo → it detects the `Dockerfile` automatically
3. Add all variables from `.env.example` under **Environment Variables**
   - Set `VA_PRIVATE_KEY` to the full contents of your `private.pem` - the DO UI handles multiline values
   - Set `SESSION_SECRET` to a strong random value (e.g. `openssl rand -hex 32`)
4. Deploy - DigitalOcean injects `PORT` automatically

## API Clients

All three clients use the [Client Credentials Grant (CCG)](https://developer.va.gov/explore/authorization/docs/client-credentials) flow with RSA JWT assertions. Each client has its own VA gateway token URL and Okta authorization server.

| Client | Scope | Endpoint |
|---|---|---|
| Veteran Verification | `veteran_status.read`, `disability_rating_summary.read`, etc. | `/services/veteran_verification/v2` |
| Letter Generator | `letters.read` | `/services/va-letter-generator/v1` |
| Education Benefits | `education.read` | `/services/benefits-education/v1/education/chapter33` |

## Route Overview

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Landing page |
| `GET` | `/guest` | Guest lookup form |
| `POST` | `/guest/lookup` | Run guest lookup |
| `GET` | `/login` | Simulated student login |
| `GET` | `/portal` | Student dashboard (auth required) |
| `POST` | `/portal/lookup` | Run portal lookup with Send to VS buttons |
| `POST` | `/portal/send-letter` | Log letter send to VS office |
| `POST` | `/letter` | Download letter PDF |
