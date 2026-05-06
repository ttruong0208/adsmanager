import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { appendJobs, readJobs, writeJobs } from './jobStore.js';
import {
  createCampaignDraft,
  createAdSetDraft,
  createAdDraft,
  createAdDraftWithObjectStoryId,
  pickFirstValidPostAndCreateAd,
  updateCampaignStatus,
  updateAdSetStatus,
  updateAdStatus,
  getAdAccount,
  getAdSet,
  getAd,
  listCampaigns,
  scanPermissions,
  classifyMetaError,
  requestPageAccessToBusiness
} from './metaApi.js';
import {
  readTokenStore,
  saveUserToken,
  clearStoredUserToken
} from './tokenStore.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FB_APP_ID = process.env.META_APP_ID || process.env.FB_APP_ID || '';
const FB_APP_SECRET = process.env.META_APP_SECRET || process.env.FB_APP_SECRET || '';
const FB_REDIRECT_URI =
  process.env.META_REDIRECT_URI || `http://localhost:${port}/auth/facebook/callback`;

app.use(express.static(path.join(__dirname, '../public')));
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
function buildAdsManagerUrl({ adAccountId, campaignId, adSetId, adId }) {
  const numericAccountId = String(adAccountId || '').replace(/^act_/, '');
  let url = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericAccountId}`;
  if (campaignId) url += `&selected_campaign_ids=${campaignId}`;
  if (adSetId) url += `&selected_adset_ids=${adSetId}`;
  if (adId) url += `&selected_ad_ids=${adId}`;
  return url;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/accounts/:adAccountId', async (req, res) => {
  try {
    const data = await getAdAccount(req.params.adAccountId);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.post('/permissions/scan', async (req, res) => {
  try {
    const { adAccountId, pageIds } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!Array.isArray(pageIds)) return res.status(400).json({ error: 'Missing pageIds' });

    const data = await scanPermissions({ adAccountId, pageIds });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message,
      errorType: err.errorType || classifyMetaError(err.message)
    });
  }
});


app.post('/permissions/request-page-access', async (req, res) => {
  try {
    const {
      businessId,
      pageIds = [],
      permittedTasks = ['ADVERTISE', 'CREATE_CONTENT']
    } = req.body || {};

    if (!businessId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing businessId'
      });
    }

    if (!Array.isArray(pageIds) || !pageIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'Missing pageIds'
      });
    }

    const result = await requestPageAccessToBusiness({
      businessId,
      pageIds,
      permittedTasks
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Request page access failed',
      errorType: err.errorType || 'UNKNOWN',
      meta: err.meta || null
    });
  }
});

app.get('/campaigns', async (req, res) => {
  try {
    const { adAccountId } = req.query;

    if (!adAccountId) {
      return res.status(400).json({ error: 'Missing adAccountId' });
    }

    const data = await listCampaigns(adAccountId);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/flow/create-campaign-and-adset-draft', async (req, res) => {
  try {
    const {
      adAccountId,
      campaignName,
      adSetName,
      objective,
      dailyBudget,
      pageId,
      optimizationGoal
    } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!campaignName) return res.status(400).json({ error: 'Missing campaignName' });
    if (!adSetName) return res.status(400).json({ error: 'Missing adSetName' });
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });

    const campaign = await createCampaignDraft({
      adAccountId,
      campaignName,
      objective,
      dailyBudget
    });

    const adSet = await createAdSetDraft({
      adAccountId,
      campaignId: campaign.id,
      adSetName,
      pageId,
      optimizationGoal
    });

    const adSetDetail = await getAdSet(adSet.id);
    const adsManagerUrl = buildAdsManagerUrl({
      adAccountId,
      campaignId: campaign.id,
      adSetId: adSet.id
    });

    res.json({
      ok: true,
      campaign: { id: campaign.id, name: campaignName },
      adSet: {
        id: adSetDetail.id,
        name: adSetDetail.name,
        status: adSetDetail.status,
        optimization_goal: adSetDetail.optimization_goal,
        destination_type: adSetDetail.destination_type
      },
      adsManagerUrl
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/flow/run-full-draft', async (req, res) => {
  try {
    const {
      adAccountId,
      campaignName,
      adSetName,
      adName,
      objective,
      dailyBudget,
      pageId,
      optimizationGoal,
      postId,
      audienceName,
      placements
    } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!campaignName) return res.status(400).json({ error: 'Missing campaignName' });
    if (!adSetName) return res.status(400).json({ error: 'Missing adSetName' });
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });
    if (!dailyBudget || Number(dailyBudget) <= 0) {
      return res.status(400).json({ error: 'Invalid dailyBudget' });
    }

    const campaign = await createCampaignDraft({
      adAccountId,
      campaignName,
      objective,
      dailyBudget
    });

    const adSet = await createAdSetDraft({
      adAccountId,
      campaignId: campaign.id,
      adSetName,
      pageId,
      optimizationGoal
    });

    const adSetDetail = await getAdSet(adSet.id);

    let adDetail = null;
    let pickedPost = null;

    if (postId) {
      const ad = await createAdDraftWithObjectStoryId({
        adAccountId,
        adSetId: adSet.id,
        adName: adName || `Ad - ${pageId}`,
        objectStoryId: postId
      });

      adDetail = await getAd(ad.id);
      pickedPost = {
        source: 'input_post_id',
        id: postId
      };
    } else {
      const picked = await pickFirstValidPostAndCreateAd({
        adAccountId,
        adSetId: adSet.id,
        adName: adName || `Ad - ${pageId}`,
        pageId,
        limit: 10
      });

      adDetail = await getAd(picked.ad.id);
      pickedPost = picked.pickedPost;
    }

    // PHASE 7: publish bằng API
    if (adDetail?.id) {
      await updateCampaignStatus({
        campaignId: campaign.id,
        status: 'ACTIVE'
      });

      await updateAdSetStatus({
        adSetId: adSet.id,
        status: 'ACTIVE'
      });

      await updateAdStatus({
        adId: adDetail.id,
        status: 'ACTIVE'
      });
    }

    const adsManagerUrl = buildAdsManagerUrl({
      adAccountId,
      campaignId: campaign.id,
      adSetId: adSet.id,
      adId: adDetail?.id
    });

    res.json({
      ok: true,
      campaign: {
        id: campaign.id,
        name: campaignName,
        status: adDetail?.id ? 'ACTIVE' : 'PAUSED'
      },
      adSet: {
        id: adSetDetail.id,
        name: adSetDetail.name,
        status: adDetail?.id ? 'ACTIVE' : adSetDetail.status,
        optimization_goal: adSetDetail.optimization_goal,
        destination_type: adSetDetail.destination_type,
        daily_budget: dailyBudget
      },
      ad: adDetail
        ? {
            id: adDetail.id,
            name: adDetail.name,
            status: 'ACTIVE',
            adset_id: adDetail.adset_id,
            campaign_id: adDetail.campaign_id
          }
        : null,
      pickedPost,
      adsManagerUrl,
      uiPlan: {
        audienceName: audienceName || null,
        placements: placements || null,
        hasPostSelectionStep: false,
        hasPublishStep: false
      },
      publishResult: adDetail?.id
        ? {
            campaignStatus: 'ACTIVE',
            adSetStatus: 'ACTIVE',
            adStatus: 'ACTIVE'
          }
        : null
    });
  } catch (err) {
    res.status(400).json({
      error: err.message,
      errorType: err.errorType || classifyMetaError(err.message)
    });
  }
});

app.post('/adsets/create-draft', async (req, res) => {
  try {
    const { adAccountId, campaignId, adSetName, pageId, optimizationGoal } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!campaignId) return res.status(400).json({ error: 'Missing campaignId' });
    if (!adSetName) return res.status(400).json({ error: 'Missing adSetName' });
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });

    const adSet = await createAdSetDraft({
      adAccountId,
      campaignId,
      adSetName,
      pageId,
      optimizationGoal
    });
    const detail = await getAdSet(adSet.id);

    const adsManagerUrl = buildAdsManagerUrl({
      adAccountId,
      campaignId,
      adSetId: adSet.id
    });

    res.json({
      ok: true,
      adSet: {
        id: detail.id,
        name: detail.name,
        status: detail.status,
        campaign_id: detail.campaign_id,
        daily_budget: detail.daily_budget,
        optimization_goal: detail.optimization_goal,
        destination_type: detail.destination_type
      },
      adsManagerUrl
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/jobs/create-adsets', async (_req, res) => {
  try {
    const jobs = readJobs();

    if (!jobs.length) {
      return res.status(400).json({ error: 'No jobs found' });
    }

    const results = [];
    const nextJobs = [...jobs];

    for (let i = 0; i < nextJobs.length; i++) {
      const job = nextJobs[i];

      if (!job.campaignId) {
        results.push({
          ok: false,
          pageId: job.pageId,
          errorType: 'missing_campaign_id',
          error: 'Missing campaignId'
        });
        continue;
      }

      if (!job.pageId) {
        results.push({
          ok: false,
          campaignId: job.campaignId,
          errorType: 'missing_page_id',
          error: 'Missing pageId'
        });
        continue;
      }

      if (!job.budget || Number(job.budget) <= 0) {
        results.push({
          ok: false,
          pageId: job.pageId,
          campaignId: job.campaignId,
          errorType: 'invalid_budget',
          error: 'Invalid budget'
        });
        continue;
      }

      try {
        const adSetName = `Nhóm QC - ${job.pageId}`;

        const created = await createAdSetDraft({
          adAccountId: job.adAccountId,
          campaignId: job.campaignId,
          adSetName,
          pageId: job.pageId
        });
        const detail = await getAdSet(created.id);

        nextJobs[i] = {
          ...job,
          adSetId: detail.id,
          adSetName: detail.name,
          adSetStatus: detail.status,
          optimizationGoal: detail.optimization_goal,
          destinationType: detail.destination_type,
          status: 'adset_created',
          adSetCreatedAt: new Date().toISOString()
        };

        results.push({
          ok: true,
          pageId: job.pageId,
          budget: job.budget,
          campaignId: job.campaignId,
          adSetId: detail.id,
          adSetName: detail.name,
          adSetStatus: detail.status
        });
      } catch (err) {
        const message = err.message || 'Unknown error';
        const lower = message.toLowerCase();

        let errorType = 'unknown';

        if (
          lower.includes('không đủ quyền đối với trang') ||
          lower.includes('khong du quyen doi voi trang') ||
          lower.includes('not authorized to use page') ||
          (lower.includes('permission') && lower.includes('page'))
        ) {
          errorType = 'no_page_permission';
        } else if (
          lower.includes('must be a valid page id') ||
          lower.includes('invalid page') ||
          lower.includes('promoted_object[page_id]')
        ) {
          errorType = 'invalid_page_id';
        }

        nextJobs[i] = {
          ...job,
          status: 'adset_failed',
          adSetError: message,
          adSetErrorType: errorType,
          adSetFailedAt: new Date().toISOString()
        };

        results.push({
          ok: false,
          pageId: job.pageId,
          budget: job.budget,
          campaignId: job.campaignId,
          errorType,
          error: message
        });
      }
    }

    writeJobs(nextJobs);

    res.json({
      ok: true,
      successCount: results.filter((x) => x.ok).length,
      failCount: results.filter((x) => !x.ok).length,
      results
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/campaigns/create-draft', async (req, res) => {
  try {
    const {
      adAccountId,
      campaignName,
      objective,
      dailyBudget,
      pageRef,
      savedAudienceName,
      postId
    } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!campaignName) return res.status(400).json({ error: 'Missing campaignName' });

    const campaign = await createCampaignDraft({
      adAccountId,
      campaignName,
      objective,
      dailyBudget
    });

    const adsManagerUrl = buildAdsManagerUrl({
      adAccountId,
      campaignId: campaign.id
    });

    res.json({
      ok: true,
      inputEcho: {
        dailyBudget,
        pageRef,
        savedAudienceName,
        postId
      },
      campaign: {
        id: campaign.id,
        name: campaignName
      },
      adsManagerUrl
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/campaigns/create-draft-batch', async (req, res) => {
  try {
    const { adAccountId, campaignNameTemplate, objective, items } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Missing items' });
    }

    const results = [];
    const failedPageIds = [];
    const jobsToSave = [];
    const numericAccountId = adAccountId.replace(/^act_/, '');

    for (const rawItem of items) {
      const pageId = String(rawItem?.pageId || '').trim();
      const budget = Number(rawItem?.budget);

      if (!pageId) {
        results.push({
          ok: false,
          pageId: '',
          budget: rawItem?.budget,
          error: 'Missing pageId'
        });
        continue;
      }

      if (!Number.isFinite(budget) || budget <= 0) {
        failedPageIds.push(pageId);
        results.push({
          ok: false,
          pageId,
          budget: rawItem?.budget,
          error: 'Invalid budget'
        });
        continue;
      }

      const campaignName = (campaignNameTemplate || 'AUTO {{pageId}}').replaceAll('{{pageId}}', pageId);

      try {
        const campaign = await createCampaignDraft({
          adAccountId,
          campaignName,
          objective,
          dailyBudget: budget
        });

        const adsManagerUrl =
          `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericAccountId}` +
          `&selected_campaign_ids=${campaign.id}`;

        const jobRecord = {
          pageId,
          budget,
          adAccountId,
          objective: objective || 'OUTCOME_ENGAGEMENT',
          campaignId: campaign.id,
          campaignName,
          adsManagerUrl,
          status: 'campaign_created',
          createdAt: new Date().toISOString()
        };

        jobsToSave.push(jobRecord);

        results.push({
          ok: true,
          ...jobRecord
        });
      } catch (err) {
        failedPageIds.push(pageId);
        results.push({
          ok: false,
          pageId,
          budget,
          error: err.message
        });
      }
    }

    appendJobs(jobsToSave);

    res.json({
      ok: true,
      successCount: results.filter((x) => x.ok).length,
      failCount: results.filter((x) => !x.ok).length,
      failedPageIds,
      savedCount: jobsToSave.length,
      results
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/jobs', (_req, res) => {
  try {
    const jobs = readJobs();
    res.json({
      ok: true,
      count: jobs.length,
      jobs
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/jobs/adsets', (_req, res) => {
  try {
    const jobs = readJobs().filter((job) => job.adSetId);
    res.json({
      ok: true,
      count: jobs.length,
      jobs
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/ads/create-draft', async (req, res) => {
  try {
    const { adAccountId, adSetId, adName, postId } = req.body;

    if (!adAccountId) return res.status(400).json({ error: 'Missing adAccountId' });
    if (!adSetId) return res.status(400).json({ error: 'Missing adSetId' });
    if (!adName) return res.status(400).json({ error: 'Missing adName' });
    if (!postId) return res.status(400).json({ error: 'Missing postId' });

    const ad = await createAdDraft({
      adAccountId,
      adSetId,
      adName,
      postId
    });

    const detail = await getAd(ad.id);
    const adsManagerUrl = buildAdsManagerUrl({
      adAccountId,
      adSetId,
      adId: ad.id
    });

    res.json({
      ok: true,
      ad: {
        id: detail.id,
        name: detail.name,
        status: detail.status,
        adset_id: detail.adset_id,
        campaign_id: detail.campaign_id
      },
      adsManagerUrl
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
async function exchangeCodeForUserToken(code) {
  if (!FB_APP_ID) throw new Error('Missing META_APP_ID');
  if (!FB_APP_SECRET) throw new Error('Missing META_APP_SECRET');
  if (!FB_REDIRECT_URI) throw new Error('Missing META_REDIRECT_URI');

  const url =
    `https://graph.facebook.com/v23.0/oauth/access_token` +
    `?client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&client_secret=${encodeURIComponent(FB_APP_SECRET)}` +
    `&code=${encodeURIComponent(code)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      data?.error?.message || 'Không đổi được code sang user token'
    );
  }

  return data;
}

async function exchangeLongLivedUserToken(shortLivedUserToken) {
  if (!FB_APP_ID) throw new Error('Missing META_APP_ID');
  if (!FB_APP_SECRET) throw new Error('Missing META_APP_SECRET');

  const url =
    `https://graph.facebook.com/v23.0/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&client_secret=${encodeURIComponent(FB_APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(shortLivedUserToken)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      data?.error?.message || 'Không đổi được long-lived user token'
    );
  }

  return data;
}


app.get('/auth/permissions', async (_req, res) => {
  try {
    const store = readTokenStore();

    if (!store?.userToken) {
      return res.status(400).json({
        ok: false,
        error: 'No token'
      });
    }

    const url =
      `https://graph.facebook.com/v23.0/me/permissions` +
      `?access_token=${encodeURIComponent(store.userToken)}`;

    const fbRes = await fetch(url);
    const data = await fbRes.json();

    return res.status(fbRes.ok ? 200 : 400).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Cannot read permissions'
    });
  }
});

app.get('/auth/facebook/start', (_req, res) => {
  if (!FB_APP_ID) {
    return res.status(400).send('Missing META_APP_ID');
  }

  const scope = [
    'ads_management',
    'ads_read',
    'pages_show_list',
    'pages_read_engagement',
    'business_management'
  
  ].join(',');

  const authUrl =
  `https://www.facebook.com/v23.0/dialog/oauth` +
  `?client_id=${encodeURIComponent(FB_APP_ID)}` +
  `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(scope)}` +
  `&auth_type=rerequest`;

  res.redirect(authUrl);
});

app.get('/auth/facebook/callback', async (req, res) => {
  try {
    const errorMessage = String(req.query.error_message || req.query.error || '');
    const errorCode = String(req.query.error_code || '');

    if (errorMessage) {
      return res.status(400).send(
        `Facebook login error${errorCode ? ` (${errorCode})` : ''}: ${errorMessage}`
      );
    }

    const code = String(req.query.code || '');
    if (!code) {
      return res.status(400).send('Missing code');
    }

    const shortToken = await exchangeCodeForUserToken(code);
    const longToken = await exchangeLongLivedUserToken(shortToken.access_token);
    const me = await getFacebookMe(longToken.access_token);

    saveUserToken({
      userToken: longToken.access_token,
      tokenType: 'user',
      expiresIn: longToken.expires_in || null,
      meta: {
        source: 'oauth_callback',
        facebookUserId: me.id || null,
        facebookUserName: me.name || null
      }
    });

    res.send(`
      <!doctype html>
      <html lang="vi">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Kết nối Facebook thành công</title>
        </head>
        <body style="font-family:Arial,sans-serif;padding:40px;text-align:center;">
          <h1>Kết nối Facebook thành công</h1>
          <p>Đã lưu token cho tài khoản: <strong>${me.name || 'Không rõ tên'}</strong></p>
          <p>Facebook ID: <strong>${me.id || 'Không rõ ID'}</strong></p>
          <p>Bạn có thể đóng tab này và quay lại ứng dụng.</p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(400).send(`Auth callback error: ${err.message}`);
  }
});
async function getFacebookMe(userToken) {
  const url =
    `https://graph.facebook.com/v23.0/me` +
    `?fields=id,name` +
    `&access_token=${encodeURIComponent(userToken)}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(data?.error?.message || 'Không lấy được thông tin tài khoản Facebook');
  }

  return data;
}

app.get('/auth/status', (_req, res) => {
  const store = readTokenStore();

  res.json({
    ok: true,
    hasToken: !!store?.userToken,
    connected: !!store?.userToken,
    tokenType: store?.tokenType || null,
    expiresAt: store?.expiresAt || null,
    updatedAt: store?.updatedAt || null,
    profile: store?.userToken
      ? {
          id: store?.meta?.facebookUserId || null,
          name: store?.meta?.facebookUserName || null
        }
      : null,
    meta: store?.meta || {}
  });
});

app.post('/auth/logout', (_req, res) => {
  clearStoredUserToken();
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
