# Xettl website

Static website with a private Supabase waitlist and consent-based PostHog and Google Analytics 4.

## Development

Requires Node.js 22 or newer.

```sh
npm ci
npm run build
npm run preview
```

Open http://127.0.0.1:8790/. The static preview does not run Netlify Functions or save signups.

## Deployment

Connect `main` in `xettl/xettl-site-new` to Netlify. The repository's `netlify.toml` sets the build command to `npm run build`, the publish directory to `public`, and the functions directory to `netlify/functions`.

Apply the SQL files in `supabase/migrations/` in filename order to a Supabase project. Configure the variables listed in `.env.example` in Netlify: public `XETTL_*` build settings and private function settings. `XETTL_ALLOWED_ORIGINS` is a function setting. Never place backend credentials in browser code or commit real environment files.

Set `XETTL_WAITLIST_ENDPOINT=/api/waitlist` and a monitored `XETTL_CONTACT_EMAIL` before a production build. Set both `XETTL_POSTHOG_TOKEN` and `XETTL_GA4_ID` to enable both analytics providers after visitor consent. Analytics is disabled in deploy previews by default.

Only `public/` is published as static content. Never publish the repository root. Signup subscriptions remain pending until email ownership verification and unsubscribe are implemented; signup does not send email.

## Verification

```sh
npm test
npm run build
npm run test:site
npx playwright install chromium
npm run preview
# In another terminal:
npm run test:browser
npm run test:analytics
```

Local tests use temporary databases and mocked external services. Verify Supabase saves and analytics delivery against configured accounts before launch.
