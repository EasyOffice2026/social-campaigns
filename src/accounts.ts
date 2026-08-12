import type { Env } from './config.js';
import type { Platform } from './types.js';

export interface AccountCheck {
  platform: Platform;
  configured: boolean;
  ok: boolean;
  detail: string;
}

/**
 * Verifies each configured credential against a cheap read endpoint. Run this
 * before a campaign goes out: LinkedIn and Facebook page tokens expire roughly
 * every 60 days, and a dead token otherwise only surfaces at publish time.
 */
export async function checkAccounts(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountCheck[]> {
  return [await checkLinkedIn(env, fetchImpl), await checkFacebook(env, fetchImpl)];
}

async function checkLinkedIn(env: Env, fetchImpl: typeof fetch): Promise<AccountCheck> {
  if (env.LINKEDIN_ACCESS_TOKEN === undefined || env.LINKEDIN_ORGANIZATION_ID === undefined) {
    return {
      platform: 'linkedin',
      configured: false,
      ok: false,
      detail: 'set LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORGANIZATION_ID',
    };
  }

  const author = encodeURIComponent(`urn:li:organization:${env.LINKEDIN_ORGANIZATION_ID}`);
  const response = await fetchImpl(
    `https://api.linkedin.com/rest/posts?q=author&author=${author}&count=1`,
    {
      headers: {
        Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
        'LinkedIn-Version': env.LINKEDIN_API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    },
  );

  if (response.ok) {
    return {
      platform: 'linkedin',
      configured: true,
      ok: true,
      detail: `token can read posts for organization ${env.LINKEDIN_ORGANIZATION_ID}`,
    };
  }

  const body = (await response.text().catch(() => '')).slice(0, 200);
  return {
    platform: 'linkedin',
    configured: true,
    ok: false,
    detail:
      response.status === 401 || response.status === 403
        ? `${response.status}: token expired, or missing r_organization_social / page admin rights - ${body}`
        : `${response.status}: ${body}`,
  };
}

async function checkFacebook(env: Env, fetchImpl: typeof fetch): Promise<AccountCheck> {
  if (env.FACEBOOK_PAGE_ACCESS_TOKEN === undefined || env.FACEBOOK_PAGE_ID === undefined) {
    return {
      platform: 'facebook',
      configured: false,
      ok: false,
      detail: 'set FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID',
    };
  }

  const params = new URLSearchParams({
    fields: 'name,id',
    access_token: env.FACEBOOK_PAGE_ACCESS_TOKEN,
  });
  const response = await fetchImpl(
    `https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION}/${env.FACEBOOK_PAGE_ID}?${params}`,
  );
  const payload = (await response.json().catch(() => ({}))) as {
    name?: string;
    error?: { message?: string };
  };

  if (response.ok && payload.error === undefined) {
    return {
      platform: 'facebook',
      configured: true,
      ok: true,
      detail: `token reaches page "${payload.name ?? env.FACEBOOK_PAGE_ID}"`,
    };
  }

  return {
    platform: 'facebook',
    configured: true,
    ok: false,
    detail: `${response.status}: ${payload.error?.message ?? 'unknown error'}`,
  };
}
