# jaas-token — Edge Function deploy guide

Mints a JaaS (8x8) moderator/guest token after verifying the caller's access
to a batch. Secrets stay in Supabase; nothing sensitive is in the repo.

## One-time setup (run from the `nips/` folder)

```bash
# 1. Log in (opens browser) and link this project
supabase login
supabase link --project-ref qajupsfbmbmbrjlqpstx

# 2. Store the three JaaS secrets (do NOT commit these).
#    Replace the values; point the private key at the .pem you downloaded from JaaS.
supabase secrets set JAAS_APP_ID="vpaas-magic-cookie-xxxxxxxxxxxx"
supabase secrets set JAAS_KID="vpaas-magic-cookie-xxxxxxxxxxxx/abc123"
supabase secrets set JAAS_PRIVATE_KEY="$(cat /path/to/your-jaas-key.pem)"

# 3. Deploy. --no-verify-jwt because the function does its own auth check
#    (it reads the caller's token from the Authorization header itself).
supabase functions deploy jaas-token --no-verify-jwt
```

## Notes
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do not set them.
- `JAAS_KID` is the full Key ID shown in the JaaS console (usually `<appId>/<short-id>`).
- To rotate: generate a new API key in JaaS, `supabase secrets set` the new KID + key, redeploy.
- Test after deploy: open a class in the portal as a teacher — you should join as
  moderator with no login prompt; a paid student joins as guest; anyone else is rejected.
