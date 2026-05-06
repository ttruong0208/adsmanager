import { getStoredUserToken } from './tokenStore.js';
function getCurrentUserToken() {
  return getStoredUserToken() || process.env.META_USER_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null;
}
const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export function normalizeAdAccountId(adAccountId) {
  const raw = String(adAccountId || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

export function normalizeNumericId(id) {
  return String(id || '').trim().replace(/^act_/, '');
}

export function classifyMetaError(message = '') {
  const lower = String(message || '').toLowerCase();

  if (
    lower.includes('not allowed for this call') ||
    lower.includes('permission') ||
    lower.includes('not authorized') ||
    lower.includes('does not have permission') ||
    lower.includes('requires business_management')
  ) {
    return 'NO_PERMISSION';
  }

  if (lower.includes('invalid') && lower.includes('page')) return 'INVALID_PAGE_ID';
  if (lower.includes('invalid') && lower.includes('account')) return 'INVALID_AD_ACCOUNT_ID';
  if (lower.includes('disabled') || lower.includes('account_status')) return 'AD_ACCOUNT_DISABLED';
  if (lower.includes('rate limit') || lower.includes('too many calls')) return 'RATE_LIMIT';

  return 'UNKNOWN';
}

async function metaFetch(path, options = {}) {
  const token = getCurrentUserToken();

  if (!token) {
    throw new Error('Missing user token. Please connect Facebook again.');
  }

  const isForm = options.body instanceof URLSearchParams;
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const err = new Error(
      data?.error?.error_user_title ||
      data?.error?.error_user_msg ||
      data?.error?.message ||
      'Meta API request failed'
    );
    err.meta = data?.error || null;
    err.errorType = classifyMetaError(err.message);
    throw err;
  }

  return data;
}

async function fetchAllPages(firstPath) {
  const token = getCurrentUserToken();
  let path = firstPath;
  const all = [];

  while (path) {
    const data = await metaFetch(path);
    if (Array.isArray(data?.data)) all.push(...data.data);

    const next = data?.paging?.next;
    if (!next) break;

    const url = new URL(next);
    path = `${url.pathname.replace(`/${API_VERSION}`, '')}${url.search}`;

    // Safety limit so a bad paging response cannot loop forever.
    if (all.length > 5000) break;
  }

  return all;
}

export async function listMyAdAccounts() {
  const token = getCurrentUserToken();
  if (!token) throw new Error('Missing user token. Please connect Facebook again.');

  return fetchAllPages(
    `/me/adaccounts?fields=id,account_id,name,account_status&limit=100&access_token=${encodeURIComponent(token)}`
  );
}

export async function listMyPages() {
  const token = getCurrentUserToken();
  if (!token) throw new Error('Missing user token. Please connect Facebook again.');

  return fetchAllPages(
    `/me/accounts?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`
  );
}

export async function scanPermissions({ adAccountId, pageIds = [] }) {
  const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
  const uniquePageIds = [...new Set(
    (pageIds || []).map((x) => String(x || '').trim()).filter(Boolean)
  )];

  let adAccount = null;
  let adAccountOk = false;
  let adAccountReason = null;

  try {
    adAccount = await getAdAccount(normalizedAdAccountId);
    adAccountOk = Boolean(adAccount?.id);
  } catch (err) {
    adAccountReason = err.errorType || 'NO_AD_ACCOUNT_PERMISSION';
  }

  const pageResults = [];

  for (const pageId of uniquePageIds) {
    try {
      const page = await metaFetch(
        `/${pageId}?fields=id,name&access_token=${encodeURIComponent(getCurrentUserToken())}`
      );

      pageResults.push({
        pageId,
        ok: Boolean(page?.id),
        name: page?.name || null,
        tasks: [],
        reason: page?.id ? null : 'NO_PAGE_PERMISSION'
      });
    } catch (err) {
      pageResults.push({
        pageId,
        ok: false,
        name: null,
        tasks: [],
        reason: err.errorType || 'NO_PAGE_PERMISSION',
        error: err.message || 'Unknown error'
      });
    }
  }

  return {
    ok: adAccountOk && pageResults.every((x) => x.ok),
    adAccount: {
      input: adAccountId,
      normalized: normalizedAdAccountId,
      ok: adAccountOk,
      id: adAccount?.id || null,
      account_id: adAccount?.account_id || null,
      name: adAccount?.name || null,
      account_status: adAccount?.account_status || null,
      reason: adAccountOk ? null : adAccountReason
    },
    pages: pageResults,
    summary: {
      totalPages: pageResults.length,
      allowedPages: pageResults.filter((x) => x.ok).length,
      blockedPages: pageResults.filter((x) => !x.ok).length
    }
  };
}

export async function getAdAccount(adAccountId) {
  const normalized = normalizeAdAccountId(adAccountId);
  return metaFetch(
    `/${normalized}?fields=id,name,account_id,account_status&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function listCampaigns(adAccountId) {
  const normalized = normalizeAdAccountId(adAccountId);
  return metaFetch(
    `/${normalized}/campaigns?fields=id,name,status&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function createCampaignDraft({
  adAccountId,
  campaignName,
  objective,
  dailyBudget
}) {
  const normalized = normalizeAdAccountId(adAccountId);
  const body = new URLSearchParams({
    name: campaignName,
    objective: objective || 'OUTCOME_ENGAGEMENT',
    status: 'PAUSED',
    special_ad_categories: '[]',
    daily_budget: String(dailyBudget),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${normalized}/campaigns`, {
    method: 'POST',
    body
  });
}

export async function createAdSetDraft({
  adAccountId,
  campaignId,
  adSetName,
  pageId,
  optimizationGoal = 'CONVERSATIONS',
  billingEvent = 'IMPRESSIONS'
}) {
  const normalized = normalizeAdAccountId(adAccountId);
  const body = new URLSearchParams({
    name: adSetName,
    campaign_id: campaignId,
    billing_event: billingEvent,
    optimization_goal: optimizationGoal,
    status: 'PAUSED',
    destination_type: 'MESSENGER',
    promoted_object: JSON.stringify({
      page_id: pageId
    }),
    targeting: JSON.stringify({
      geo_locations: {
        custom_locations: [
          {
            latitude: 13.695484180036347,
            longitude: 108.08100700378418,
            radius: 4,
            distance_unit: 'kilometer'
          }
        ]
      },
      publisher_platforms: ['messenger', 'facebook'],
      facebook_positions: ['feed'],
      messenger_positions: ['story']
    }),
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${normalized}/adsets`, {
    method: 'POST',
    body
  });
}

export async function createAdDraft({
  adAccountId,
  adSetId,
  adName,
  postId
}) {
  const normalized = normalizeAdAccountId(adAccountId);
  const body = new URLSearchParams({
    name: adName,
    adset_id: adSetId,
    status: 'PAUSED',
    creative: JSON.stringify({
      object_story_id: postId
    }),
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${normalized}/ads`, {
    method: 'POST',
    body
  });
}

export async function getAd(adId) {
  return metaFetch(
    `/${adId}?fields=id,name,status,adset_id,campaign_id,creative&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function getAdSet(adSetId) {
  return metaFetch(
    `/${adSetId}?fields=id,name,status,campaign_id,daily_budget,optimization_goal,destination_type&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function createAdDraftWithObjectStoryId({
  adAccountId,
  adSetId,
  adName,
  objectStoryId
}) {
  const normalized = normalizeAdAccountId(adAccountId);
  const body = new URLSearchParams({
    name: adName,
    adset_id: adSetId,
    status: 'PAUSED',
    creative: JSON.stringify({
      object_story_id: objectStoryId
    }),
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${normalized}/ads`, {
    method: 'POST',
    body
  });
}

async function graphFetchWithToken(path, accessToken, options = {}) {
  const isForm = options.body instanceof URLSearchParams;
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const err = new Error(
      data?.error?.error_user_title ||
      data?.error?.error_user_msg ||
      data?.error?.message ||
      'Graph API request failed'
    );
    err.meta = data?.error || null;
    err.errorType = classifyMetaError(err.message);
    throw err;
  }

  return data;
}

export async function getPageAccessToken(pageId) {
  const userToken = getCurrentUserToken();

  if (!userToken) {
    throw new Error('Missing user token. Please connect Facebook again.');
  }

  const page = await graphFetchWithToken(
    `/${pageId}?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
    userToken
  );

  if (!page) {
    throw new Error(`Không tìm thấy page ${pageId}`);
  }

  if (!page.access_token) {
    throw new Error(`Page ${pageId} không có access_token`);
  }

  return {
    id: page.id,
    name: page.name,
    accessToken: page.access_token
  };
}

export async function listPagePostsWithPageToken(pageId, pageAccessToken, limit = 1) {
  return graphFetchWithToken(
    `/${pageId}/posts?fields=id,message,created_time,permalink_url,status_type&limit=${limit}&access_token=${encodeURIComponent(pageAccessToken)}`,
    pageAccessToken
  );
}

export async function pickFirstValidPostAndCreateAd({
  adAccountId,
  adSetId,
  adName,
  pageId,
  limit = 10
}) {
  const pageInfo = await getPageAccessToken(pageId);

  const postsRes = await listPagePostsWithPageToken(pageId, pageInfo.accessToken, limit);
  const posts = Array.isArray(postsRes?.data) ? postsRes.data : [];

  if (!posts.length) {
    throw new Error(`Không tìm thấy post nào của page ${pageId}`);
  }

  const tried = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    try {
      const ad = await createAdDraftWithObjectStoryId({
        adAccountId,
        adSetId,
        adName,
        objectStoryId: post.id
      });

      return {
        ok: true,
        pickedPost: {
          source: 'auto_first_valid_post',
          index: i + 1,
          id: post.id,
          message: post.message || '',
          created_time: post.created_time || null,
          permalink_url: post.permalink_url || null
        },
        ad
      };
    } catch (err) {
      tried.push({
        index: i + 1,
        postId: post.id,
        error: err.message || 'Unknown error'
      });
    }
  }

  throw new Error(
    `Không có post nào hợp lệ để tạo ad. Tried: ${JSON.stringify(tried)}`
  );
}

export async function updateCampaignStatus({
  campaignId,
  status = 'ACTIVE'
}) {
  const body = new URLSearchParams({
    status,
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${campaignId}`, {
    method: 'POST',
    body
  });
}

export async function updateAdSetStatus({
  adSetId,
  status = 'ACTIVE'
}) {
  const body = new URLSearchParams({
    status,
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${adSetId}`, {
    method: 'POST',
    body
  });
}

export async function updateAdStatus({
  adId,
  status = 'ACTIVE'
}) {
  const body = new URLSearchParams({
    status,
    access_token: getCurrentUserToken()
  });

  return metaFetch(`/${adId}`, {
    method: 'POST',
    body
  });
}
function buildFacebookProfileUrl(idOrUrl) {
  const raw = String(idOrUrl || '').trim();

  if (!raw) return '';

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.endsWith('#') ? raw : `${raw}#`;
  }

  return `https://www.facebook.com/profile.php?id=${encodeURIComponent(raw)}#`;
}



export async function requestPageAccessToBusiness({
  businessId,
  pageIds = [],
  permittedTasks = ['ADVERTISE', 'CREATE_CONTENT']
}) {
  const token = getCurrentUserToken();

  if (!token) {
    throw new Error('Missing user token. Please connect Facebook again.');
  }

  const cleanBusinessId = String(businessId || '').trim();
  const uniquePageIds = [
    ...new Set(
      (pageIds || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )
  ];

  if (!cleanBusinessId) {
    throw new Error('Missing businessId.');
  }

  if (!uniquePageIds.length) {
    throw new Error('Missing pageIds.');
  }

  const results = [];

  for (const pageId of uniquePageIds) {
    let resolved = null;

    try {
      resolved = await resolveFacebookPageId(pageId);

      const body = new URLSearchParams({
        page_id: resolved.resolvedPageId,
        permitted_tasks: JSON.stringify(permittedTasks),
        access_token: token
      });

      const result = await metaFetch(`/${cleanBusinessId}/client_pages`, {
        method: 'POST',
        body
      });

      results.push({
        pageId,
        resolvedPageId: resolved.resolvedPageId,
        name: resolved.name,
        link: resolved.link,
        ok: true,
        status: 'REQUESTED_OR_ADDED',
        result
      });
    } catch (err) {
      results.push({
        pageId,
        resolvedPageId: resolved?.resolvedPageId || null,
        name: resolved?.name || null,
        link: resolved?.link || null,
        ok: false,
        status: err.errorType || 'FAILED',
        error: err.message || 'Unknown error',
        meta: err.meta || null
      });
    }
  }

  return {
    ok: results.every((x) => x.ok),
    businessId: cleanBusinessId,
    total: results.length,
    success: results.filter((x) => x.ok).length,
    failed: results.filter((x) => !x.ok).length,
    results
  };
}

async function resolveFacebookPageId(input) {
  const token = getCurrentUserToken();
  const raw = String(input || '').trim();

  if (!raw) {
    throw new Error('Missing page input.');
  }

  const url = raw.startsWith('http')
    ? raw
    : `https://facebook.com/${raw}`;

  const data = await metaFetch(
    `/?id=${encodeURIComponent(url)}&fields=id,name,link&access_token=${encodeURIComponent(token)}`
  );

  if (!data?.id) {
    throw new Error(`Không resolve được Page ID từ ${raw}`);
  }

  return {
    input: raw,
    resolvedPageId: data.id,
    name: data.name || null,
    link: data.link || url
  };
}