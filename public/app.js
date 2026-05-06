const $ = (id) => document.getElementById(id);

const els = {
  backendUrl: $('backendUrl'),
  adAccountId: $('adAccountId'),
  objective: $('objective'),
  postId: $('postId'),
  defaultPageName: $('defaultPageName'),
  defaultBudget: $('defaultBudget'),
  batchInput: $('batchInput'),
  permissionCheckBtn: $('permissionCheckBtn'),
  runFullFlowBtn: $('runFullFlowBtn'),
  openAdsManagerBtn: $('openAdsManagerBtn'),
  status: $('status'),
  authStatus: $('authStatus'),
  fbIdentity: $('fbIdentity'),
  loginFacebookBtn: $('loginFacebookBtn'),
  businessId: document.getElementById('businessId'),
requestAccessBtn: document.getElementById('requestAccessBtn'),
permissionInput: document.getElementById('permissionInput'),
};

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function setStatusHtml(html) {
  els.status.innerHTML = html;
}

function setStatus(message) {
  setStatusHtml(`<div class="log-line">${escapeHtml(message)}</div>`);
}

function appendStatus(message, type = 'normal') {
  const cls = `log-line log-${type}`;
  const icon =
    type === 'success' ? '✅' :
    type === 'error' ? '❌' :
    type === 'running' ? '⏳' :
    type === 'section' ? '📌' :
    '•';

  els.status.innerHTML += `<div class="${cls}">${icon} ${escapeHtml(message)}</div>`;
}

function appendStatusLink(label, url) {
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);

  els.status.innerHTML += `
    <div class="log-line log-link">
      🔗 ${safeLabel}: <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Mở Ads Manager</a>
    </div>
  `;
}

function appendNameLink(name, url) {
  const safeName = escapeHtml(name);
  const safeUrl = escapeHtml(url);

  els.status.innerHTML += `
    <div class="log-line log-success">
      ✅ ${safeName} - <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">Mở link</a>
    </div>
  `;
}

function appendDivider() {
  els.status.innerHTML += `<div class="log-divider"></div>`;
}

function getBackendUrl() {
  return '';
}

function renderFacebookIdentity(profile) {
  if (!els.fbIdentity) return;

  if (!profile) {
    els.fbIdentity.style.display = 'none';
    els.fbIdentity.textContent = '';
    return;
  }

  const name = profile.name || 'Không rõ tên';
  const id = profile.id || 'Không rõ ID';

  els.fbIdentity.style.display = 'block';
  els.fbIdentity.textContent = `Đang kết nối: ${name} | Facebook ID: ${id}`;
}

async function checkFacebookAuth() {
  els.authStatus.className = 'auth-status';
  els.authStatus.textContent = 'Đang kiểm tra trạng thái kết nối...';

  try {
    const res = await fetch(`${getBackendUrl()}/auth/status`);
    const data = await res.json();

    if (data?.hasToken) {
      els.authStatus.textContent = 'Đã kết nối Facebook';
      els.authStatus.className = 'auth-status ok';
      els.loginFacebookBtn.textContent = 'Kết nối lại Facebook';
      renderFacebookIdentity(data.profile || null);
    } else {
      els.authStatus.textContent = 'Chưa kết nối Facebook';
      els.authStatus.className = 'auth-status warn';
      els.loginFacebookBtn.textContent = 'Đăng nhập Facebook';
      renderFacebookIdentity(null);
    }
  } catch (err) {
    els.authStatus.textContent = 'Không kết nối được backend';
    els.authStatus.className = 'auth-status warn';
    renderFacebookIdentity(null);
  }
}

function parseBatchInput(raw) {
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  const items = [];
  const errors = [];
  const defaultPageName = (els.defaultPageName?.value || '').trim();
  const budgetRaw = (els.defaultBudget?.value || '').trim();
  const budget = Number(budgetRaw);

  if (!Number.isFinite(budget) || budget <= 0) {
    errors.push(`Budget chung không hợp lệ: ${budgetRaw || '(trống)'}`);
    return { items, errors };
  }

  for (const [index, line] of lines.entries()) {
    const pageId = line.trim();

    if (!pageId) {
      errors.push(`Dòng ${index + 1} thiếu pageId`);
      continue;
    }

    const pageName = defaultPageName || pageId;

    items.push({ pageId, pageName, budget });
  }

  return { items, errors };
}

function parsePageIdsOnly(raw) {
  return [
    ...new Set(
      String(raw || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];
}

function buildPayloadFromFirstItem(item) {
  return {
    adAccountId: els.adAccountId.value.trim(),
    campaignName: `AUTO ${item.pageName} - ${item.pageId}`,
    adSetName: `Nhóm QC - ${item.pageName} - ${item.pageId}`,
    adName: `Ad - ${item.pageName} - ${item.pageId}`,
    objective: els.objective.value || 'OUTCOME_ENGAGEMENT',
    dailyBudget: item.budget,
    pageId: item.pageId,
    pageName: item.pageName,
    optimizationGoal: 'CONVERSATIONS',
    postId: els.postId.value.trim() || ''
  };
}

let running = false;

async function scanPermissionsForItems(items, { render = true } = {}) {
  const adAccountId = els.adAccountId.value.trim();
  const pageIds = [
    ...new Set(
      items
        .map((item) => String(item.pageId || '').trim())
        .filter(Boolean)
    )
  ];

  if (!adAccountId) {
    throw new Error('Thiếu Ad Account ID.');
  }

  if (!pageIds.length) {
    throw new Error('Không có pageId để check quyền.');
  }

  const res = await fetch(`${getBackendUrl()}/permissions/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adAccountId, pageIds })
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`API /permissions/scan không trả JSON. HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  const blockedPages = (data.pages || []).filter((x) => !x.ok);
  const allowedPages = (data.pages || []).filter((x) => x.ok);

  if (render) {
    if (!data.adAccount?.ok) {
      appendStatus('ACT không có quyền', 'error');
      return data;
    }

    if (!blockedPages.length) {
      appendStatus(`Tất cả ${allowedPages.length} ID đều có quyền`, 'success');
    } else {
      appendStatus(`${blockedPages.length}/${data.pages.length} ID không có quyền`, 'error');

      for (const page of blockedPages) {
        appendStatus(`${page.pageId} không có quyền`, 'error');
      }
    }
  }

  return data;
}

async function checkPermissionsOnly() {
  if (running) return;
  running = true;
  setStatusHtml('');

  try {
    const rawPermissionInput = els.permissionInput?.value || els.batchInput?.value || '';
const pageIds = parsePageIdsOnly(rawPermissionInput);

const items = pageIds.map((pageId) => ({
  pageId,
  pageName: pageId,
  budget: Number(els.defaultBudget?.value || 100)
}));

const errors = [];

    if (errors.length) {
      throw new Error(`Lỗi input:\n${errors.join('\n')}`);
    }

    if (!items.length) {
      throw new Error('Không có record hợp lệ.');
    }

    appendStatus('Bắt đầu check quyền trước khi chạy', 'section');
    await scanPermissionsForItems(items, { render: true });
    appendDivider();
    appendStatus('Check quyền xong.', 'section');
  } catch (err) {
    appendStatus(err.message, 'error');
  } finally {
    running = false;
  }
}
async function requestPageAccessForItems(pageIds = []) {
  const businessId = els.businessId?.value?.trim();

  pageIds = [
    ...new Set(
      (pageIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  ];

  if (!businessId) {
    throw new Error('Thiếu Business ID.');
  }

  if (!pageIds.length) {
    throw new Error('Không có ID để thêm quyền.');
  }

  appendStatus(`Đang thêm/request quyền cho ${pageIds.length} ID...`, 'running');

  const res = await fetch(`${getBackendUrl()}/permissions/request-page-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessId,
      pageIds,
      permittedTasks: ['ADVERTISE', 'CREATE_CONTENT']
    })
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`API request-page-access không trả JSON. HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  const failed = (data.results || []).filter((x) => !x.ok);
  const success = (data.results || []).filter((x) => x.ok);

  appendStatus(`Đã gửi request/thêm quyền: ${success.length}/${data.total || pageIds.length} ID`, failed.length ? 'running' : 'success');

  for (const item of failed) {
    appendStatus(`${item.pageId} lỗi: ${item.error || item.status}`, 'error');
  }

  return data;
}
async function runFullFlow() {
  if (running) return;
  running = true;

  setStatusHtml('');

  try {
    const { items, errors } = parseBatchInput(els.batchInput.value || '');

    if (errors.length) {
      throw new Error(`Lỗi input:\n${errors.join('\n')}`);
    }

    if (!items.length) {
      throw new Error('Không có record hợp lệ.');
    }

    appendStatus(`Bắt đầu chạy ${items.length} dòng`, 'section');

    const permissionScan = await scanPermissionsForItems(items, { render: true });
    if (!permissionScan.adAccount?.ok) {
      throw new Error(`Ad Account chưa có quyền trong token/BM: ${els.adAccountId.value.trim()}`);
    }

    const blockedPageMap = new Map(
      (permissionScan.pages || [])
        .filter((x) => !x.ok)
        .map((x) => [String(x.pageId), x])
    );

    const summary = {
      success: 0,
      failed: 0,
      skippedNoPermission: 0
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const payload = buildPayloadFromFirstItem(item);

      appendDivider();
      appendStatus(`Dòng ${i + 1}/${items.length}: ${item.pageName} (${item.pageId})`, 'running');

      const blocked = blockedPageMap.get(String(item.pageId));
      if (blocked) {
        summary.skippedNoPermission += 1;
        appendStatus(`${item.pageName} - SKIP: page chưa cấp quyền vào Business/token`, 'error');
        continue;
      }

      try {
        const res = await fetch(`${getBackendUrl()}/flow/run-full-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok || !data?.ok) {
          summary.failed += 1;
          const errorType = data?.errorType ? ` [${data.errorType}]` : '';
          appendStatus(`${item.pageName} - ${data?.error || 'Lỗi backend'}${errorType}`, 'error');
          continue;
        }

        summary.success += 1;
        if (data.adsManagerUrl) {
          appendNameLink(item.pageName, data.adsManagerUrl);
        } else {
          appendStatus(`${item.pageName} - Thành công`, 'success');
        }
      } catch (err) {
        summary.failed += 1;
        appendStatus(`${item.pageName} - ${err.message}`, 'error');
      }
    }

    appendDivider();
    appendStatus(`Tổng kết: SUCCESS ${summary.success} | SKIP_NO_PERMISSION ${summary.skippedNoPermission} | FAILED ${summary.failed}`, 'section');
    appendStatus('Đã chạy xong tất cả các dòng.', 'section');
  } catch (err) {
    setStatusHtml('');
    appendStatus(err.message, 'error');
    console.error(err);
  } finally {
    running = false;
  }
}


function openAdsManager() {
  window.open(`${getBackendUrl()}/auth/status`, '_blank');
}

els.loginFacebookBtn.addEventListener('click', () => {
  window.open(`${getBackendUrl()}/auth/facebook/start`, '_blank');
});

els.requestAccessBtn?.addEventListener('click', async () => {
  try {
    appendDivider();

    const rawPermissionInput = els.permissionInput?.value || els.batchInput?.value || '';
    const pageIds = parsePageIdsOnly(rawPermissionInput);

    if (!pageIds.length) {
      appendStatus('Chưa nhập ID nào trong ô Danh sách pageId.', 'error');
      return;
    }

    await requestPageAccessForItems(pageIds);

    appendStatus('Xong. Bấm Check quyền lại để kiểm tra.', 'success');
  } catch (err) {
    appendStatus(`Lỗi thêm quyền: ${err.message || 'Unknown error'}`, 'error');
  }
});

els.permissionCheckBtn.addEventListener('click', checkPermissionsOnly);
els.runFullFlowBtn.addEventListener('click', runFullFlow);
els.openAdsManagerBtn.addEventListener('click', openAdsManager);
els.backendUrl.addEventListener('change', checkFacebookAuth);

checkFacebookAuth();