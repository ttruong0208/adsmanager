import { getStoredUserToken } from './tokenStore.js';
function getCurrentUserToken() {
  return getStoredUserToken() || process.env.META_USER_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || null;
}
const API_VERSION = process.env.META_API_VERSION || 'v23.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

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

    throw new Error(
      data?.error?.error_user_title ||
      data?.error?.error_user_msg ||
      data?.error?.message ||
      'Meta API request failed'
    );
  }

  return data;
}

export async function getAdAccount(adAccountId) {
  return metaFetch(
    `/${adAccountId}?fields=id,name,account_id,account_status&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function listCampaigns(adAccountId) {
  return metaFetch(
    `/${adAccountId}/campaigns?fields=id,name,status&access_token=${encodeURIComponent(getCurrentUserToken())}`
  );
}

export async function createCampaignDraft({
  adAccountId,
  campaignName,
  objective,
  dailyBudget
}) {
  const body = new URLSearchParams({
    name: campaignName,
    objective: objective || 'OUTCOME_ENGAGEMENT',
    status: 'PAUSED',
    special_ad_categories: '[]',
    daily_budget: String(dailyBudget),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    access_token: getCurrentUserToken()
  });



  return metaFetch(`/${adAccountId}/campaigns`, {
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



  return metaFetch(`/${adAccountId}/adsets`, {
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
    const body = new URLSearchParams({
      name: adName,
      adset_id: adSetId,
      status: 'PAUSED',
      creative: JSON.stringify({
        object_story_id: postId
      }),
      access_token: getCurrentUserToken()
    });
  

  
    return metaFetch(`/${adAccountId}/ads`, {
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
  const body = new URLSearchParams({
    name: adName,
    adset_id: adSetId,
    status: 'PAUSED',
    creative: JSON.stringify({
      object_story_id: objectStoryId
    }),
    access_token: getCurrentUserToken()
  });



  return metaFetch(`/${adAccountId}/ads`, {
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

    throw new Error(
      data?.error?.error_user_title ||
      data?.error?.error_user_msg ||
      data?.error?.message ||
      'Graph API request failed'
    );
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