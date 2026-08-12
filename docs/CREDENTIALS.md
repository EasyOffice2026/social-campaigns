# Getting the credentials

Two accounts to set up: a LinkedIn app with Community Management access, and a
Meta app with a Page access token. The LinkedIn access request is reviewed by
LinkedIn, so start it first.

Verify everything at any point with:

```bash
npm run campaigns -- check
```

---

## LinkedIn Company Page

You need `w_organization_social` (post) and `r_organization_social` (read back),
which are only granted with the **Community Management API** product.

1. Confirm you are an **ADMINISTRATOR** or **CONTENT_ADMIN** of the Company Page.
   The token inherits your page role — without one of these roles no scope helps.
2. Create an app at https://www.linkedin.com/developers/apps, associated with the
   Company Page, and verify the app from the page (the verification link the
   portal gives you must be opened by a page admin).
3. In **Products**, request **Community Management API** and complete the access
   request form. Development-tier access is reviewed by LinkedIn; expect days,
   not minutes. A missing page verification or an incomplete form is the usual
   rejection reason.
4. Once approved, run the OAuth 2.0 authorization code flow requesting
   `w_organization_social r_organization_social`, and exchange the code for an
   access token.
5. Find the organization id — the numeric part of `urn:li:organization:5583111`.
   It is in the page admin URL.

```bash
LINKEDIN_ACCESS_TOKEN=<token from step 4>
LINKEDIN_ORGANIZATION_ID=5583111
LINKEDIN_API_VERSION=202606   # YYYYMM, sent as the LinkedIn-Version header
```

Tokens last ~60 days. Refresh them with the refresh token from step 4 before they
lapse; `check` tells you when a token has stopped working.

---

## Facebook Page

You need a **Page** access token (not a user token) with `pages_manage_posts` and
`pages_read_engagement`, from a user who can perform `CREATE_CONTENT` on the page.

1. Create an app at https://developers.facebook.com/apps (type: Business).
2. Add **Facebook Login for Business** and request `pages_manage_posts`,
   `pages_read_engagement`, `pages_show_list`.
3. In the Graph API Explorer, select the app, grant those permissions, then get a
   **Page** token: `GET /me/accounts` returns your pages with their
   `access_token` and `id`.
4. Exchange the short-lived token for a long-lived one (~60 days):

```bash
curl "https://graph.facebook.com/v21.0/oauth/access_token\
?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>\
&fb_exchange_token=<SHORT_LIVED_TOKEN>"
```

5. While the app is in development mode it can only post to pages you administer
   — which is all we need. Going through **App Review** is only necessary if the
   tool ever posts for someone else's page.
6. If the page has **Page Publishing Authorization** or 2FA enforced, complete
   those or publish calls fail.

```bash
FACEBOOK_PAGE_ACCESS_TOKEN=<long-lived page token>
FACEBOOK_PAGE_ID=<page id from /me/accounts>
```

---

## Later: X and Instagram

Neither is configured yet; a campaign that targets them fails with a clear
"no publisher configured" error rather than silently skipping.

- **X** — `POST /2/tweets` with OAuth 2.0 and `tweet.write`. There is no free
  tier since Feb 2026: ~$0.015/post, ~$0.20/post containing a link.
- **Instagram** — needs a Business/Creator account linked to the Facebook Page,
  `instagram_content_publish`, and media served from a public HTTPS URL (the API
  will not accept a file upload). Hard limit of 50 API-published posts/24h.

Both slot in as another file under `src/publishers/` plus their env vars in
`buildRoutes`.
