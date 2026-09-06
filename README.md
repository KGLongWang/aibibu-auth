# Aibibu Auth

Standalone Aibibu authentication frontend. It uses the public Supabase key in
the browser and returns the short-lived Supabase access token to an approved
client through a validated redirect or `postMessage` flow.

The frontend never receives or embeds the Supabase service-role key. Protected
API calls are verified by the receiving backend, including `aibibu-server`.

## Local development

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

## Production

The Docker image serves the static app on port 80. `/v1/auth/` is proxied to
`aibibu-server` over the private Docker network. `docker-compose.yml` maps it
to `127.0.0.1:4174`; Caddy exposes it as `auth.aibibu.com`.
