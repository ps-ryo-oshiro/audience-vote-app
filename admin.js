const adminLoginForm = document.getElementById('admin-login-form');
const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const loginMessage = document.getElementById('login-message');
const winnerName = document.getElementById('winner-name');
const toggleVotingStatus = document.getElementById('toggle-voting-status');
const summaryTableWrap = document.getElementById('summary-table-wrap');
const globalResultsBody = document.getElementById('global-results-body');

const participationPanel = document.getElementById('participation-panel');
const participationCounter = document.getElementById('participation-counter');
const participationMessage = document.getElementById('participation-message');
const finalistListBody = document.getElementById('finalist-list-body');
const candidateListBody = document.getElementById('candidate-list-body');

const adminState = {
  loggedIn: false,
  teams: [],
  isOpen: true
};

const SECTION_LABELS = {
  life: '🏡 ライフ部門',
  work: '💼 ワーク部門',
  local: '📍 ローカル部門'
};

const DEFAULT_TEAMS = [
  { id: 'entry-01', entryNo: 1, title: 'ライフサポートアプリ', section: 'life', videoUrl: 'https://example.com/video/entry-01', finalist: true, participating: true },
  { id: 'entry-02', entryNo: 2, title: '健康管理アプリ', section: 'life', videoUrl: 'https://example.com/video/entry-02', finalist: false, participating: false },
  { id: 'entry-03', entryNo: 3, title: '業務効率化ツール', section: 'work', videoUrl: 'https://example.com/video/entry-03', finalist: true, participating: true },
  { id: 'entry-04', entryNo: 4, title: 'コミュニケーション支援', section: 'work', videoUrl: 'https://example.com/video/entry-04', finalist: false, participating: true },
  { id: 'entry-05', entryNo: 5, title: '地域活性化アプリ', section: 'local', videoUrl: 'https://example.com/video/entry-05', finalist: true, participating: false },
  { id: 'entry-06', entryNo: 6, title: 'まちのおすすめ案内', section: 'local', videoUrl: '', finalist: false, participating: false }
];

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = `message ${type}`;
  el.classList.remove('hidden');
}

function hideMessage(el) {
  el.textContent = '';
  el.className = 'message hidden';
}

function isFirebaseConfigured() {
  const config = window.firebaseConfig || {};
  return !!config.apiKey && config.apiKey !== 'YOUR_API_KEY' && !!config.databaseURL && config.databaseURL !== 'https://YOUR_PROJECT-default-rtdb.firebaseio.com';
}

function getLocalStorageData(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(`audienceApp:${key}`) || 'null');
    if (saved === null) {
      localStorage.setItem(`audienceApp:${key}`, JSON.stringify(fallback));
      return fallback;
    }
    return saved;
  } catch (error) {
    return fallback;
  }
}

function setLocalStorageData(key, value) {
  localStorage.setItem(`audienceApp:${key}`, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* 表示判定。3か所で揃える判定規則。app.js・admin.js・worker.js で同じ内容にすること */
function isVisibleTeam(team) {
  return !!team && (team.finalist === true || team.participating === true);
}

function ensureFirebase() {
  if (!window.firebase) {
    throw new Error('Firebase SDK が読み込まれていません。');
  }

  const config = window.firebaseConfig || {};
  if (!config.apiKey || config.apiKey === 'YOUR_API_KEY') {
    throw new Error('Firebase の設定が未完了です。firebase-config.js を更新してください。');
  }

  if (!window.firebase.apps.length) {
    window.firebase.initializeApp(config);
  }

  return window.firebase.database();
}

function getDemoAdmin() {
  return window.audienceDemoAdmin || { username: 'admin', password: 'admin123' };
}

function renderSummaryTable(teams, votes) {
  const sectionGroups = { life: [], work: [], local: [] };
  teams.forEach((team) => {
    if (sectionGroups[team.section]) {
      sectionGroups[team.section].push(team);
    }
  });

  const sectionRows = Object.entries(sectionGroups)
    .map(([section, list]) => {
      const rows = list.map((team) => {
        const count = votes.filter((vote) => vote.teamId === team.id).length;
        return `<tr><td>${team.title}</td><td>${count}</td></tr>`;
      }).join('');

      return `
        <div style="margin-bottom: 24px;">
          <h4>${SECTION_LABELS ? SECTION_LABELS[section] || section : section}</h4>
          <table>
            <thead><tr><th>アプリ名</th><th>得票数</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="2">データなし</td></tr>'}</tbody>
          </table>
        </div>
      `;
    }).join('');

  summaryTableWrap.innerHTML = sectionRows || '<div class="empty-box">集計対象のアプリがありません。</div>';
}

function renderGlobalResults(teams, votes) {
  const rows = teams.map((team) => {
    const count = votes.filter((vote) => vote.teamId === team.id).length;
    return `<tr>
      <td>${team.title}</td><td>${team.section}</td><td>${count}</td>
    </tr>`;
  }).join('');

  globalResultsBody.innerHTML = rows || '<tr><td colspan="3">データなし</td></tr>';
}

function byEntryNo(a, b) {
  const aNo = typeof a.entryNo === 'number' ? a.entryNo : Infinity;
  const bNo = typeof b.entryNo === 'number' ? b.entryNo : Infinity;
  return aNo - bNo;
}

function computeFinalists(teams) {
  return teams.filter((team) => team.finalist === true).slice().sort(byEntryNo);
}

function computeCandidates(teams) {
  return teams.filter((team) => team.finalist !== true).slice().sort(byEntryNo);
}

function renderParticipationPanel(teams) {
  const finalists = computeFinalists(teams);
  const candidates = computeCandidates(teams);

  finalistListBody.innerHTML = finalists.map((team) => {
    const no = typeof team.entryNo === 'number' ? team.entryNo : '-';
    return `<tr data-team-id="${escapeHtml(team.id)}">
      <td>${no}</td>
      <td>${escapeHtml(team.title)}</td>
      <td>${escapeHtml(SECTION_LABELS[team.section] || team.section)}</td>
      <td>本戦（常に表示）</td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">本戦チームがありません。</td></tr>';

  candidateListBody.innerHTML = candidates.map((team) => {
    const no = typeof team.entryNo === 'number' ? team.entryNo : '-';
    return `<tr data-team-id="${escapeHtml(team.id)}">
      <td>${no}</td>
      <td>${escapeHtml(team.title)}</td>
      <td>${escapeHtml(SECTION_LABELS[team.section] || team.section)}</td>
      <td><input type="checkbox" class="participating-toggle" data-team-id="${escapeHtml(team.id)}" ${team.participating === true ? 'checked' : ''} /></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4">敗者復活候補がありません。</td></tr>';

  updateParticipationCounter();
}

function updateParticipationCounter() {
  const candidates = computeCandidates(adminState.teams);
  const shown = candidates.filter((team) => isVisibleTeam(team)).length;
  participationCounter.textContent = `${shown} / ${candidates.length}`;
}

candidateListBody.addEventListener('change', async (event) => {
  const el = event.target;
  if (!el.classList.contains('participating-toggle')) return;

  const teamId = el.dataset.teamId;
  const participating = el.checked;
  hideMessage(participationMessage);

  try {
    if (isFirebaseConfigured()) {
      await ensureFirebase().ref(`audienceApp/teams/${teamId}/participating`).set(participating);
    } else {
      const teams = getLocalStorageData('teams', DEFAULT_TEAMS).map((team) =>
        team.id === teamId ? { ...team, participating } : team
      );
      setLocalStorageData('teams', teams);
    }

    const team = adminState.teams.find((t) => t.id === teamId);
    if (team) team.participating = participating;
    updateParticipationCounter();
  } catch (error) {
    console.error(error);
    el.checked = !participating;
    showMessage(participationMessage, `表示状態の更新に失敗しました: ${error.message}`, 'error');
  }
});

function determineWinner(teams, votes) {
  if (!teams.length) {
    winnerName.textContent = '未判定';
    return;
  }

  const counts = teams.map((team) => ({
    id: team.id,
    title: team.title,
    count: votes.filter((vote) => vote.teamId === team.id).length
  }));

  const winner = counts.reduce((top, current) => (current.count > top.count ? current : top), counts[0]);
  winnerName.textContent = winner ? winner.title : '未判定';
}

function updateVotingToggle() {
  toggleVotingStatus.textContent = adminState.isOpen ? '投票を停止する' : '投票を開始する';
  toggleVotingStatus.className = `secondary-button ${adminState.isOpen ? 'open' : 'closed'}`;
}

async function fetchDashboardData() {
  if (isFirebaseConfigured()) {
    const db = ensureFirebase();
    const [teamsSnap, votesSnap, settingsSnap] = await Promise.all([
      db.ref('audienceApp/teams').once('value'),
      db.ref('audienceApp/votes').once('value'),
      db.ref('audienceApp/settings').once('value')
    ]);

    const teams = Object.entries(teamsSnap.val() || {}).map(([id, team]) => ({ id, ...team }));
    const votes = Object.values(votesSnap.val() || {});
    const settings = settingsSnap.val() || {};
    adminState.teams = teams;
    adminState.isOpen = !!settings.isOpen;

    renderSummaryTable(teams, votes);
    renderGlobalResults(teams, votes);
    renderParticipationPanel(teams);
    determineWinner(teams, votes);
    updateVotingToggle();
    return;
  }

  const teams = getLocalStorageData('teams', DEFAULT_TEAMS);
  const votes = getLocalStorageData('votes', []);
  const settings = getLocalStorageData('settings', { isOpen: true });
  adminState.teams = teams;
  adminState.isOpen = !!settings.isOpen;

  renderSummaryTable(teams, votes);
  renderGlobalResults(teams, votes);
  renderParticipationPanel(teams);
  determineWinner(teams, votes);
  updateVotingToggle();
}

toggleVotingStatus.addEventListener('click', async () => {
  if (!adminState.loggedIn) return;

  const nextState = !adminState.isOpen;

  if (isFirebaseConfigured()) {
    const db = ensureFirebase();
    await db.ref('audienceApp/settings').set({ isOpen: nextState });
  } else {
    setLocalStorageData('settings', { isOpen: nextState });
  }

  adminState.isOpen = nextState;
  updateVotingToggle();
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage(loginMessage);

  const username = document.getElementById('admin-id').value.trim();
  const password = document.getElementById('admin-password').value.trim();
  const { username: adminUser, password: adminPassword } = getDemoAdmin();

  if (username !== adminUser || password !== adminPassword) {
    showMessage(loginMessage, 'ID / パスワードが正しくありません。', 'error');
    return;
  }

  adminState.loggedIn = true;
  loginPanel.classList.add('hidden');
  dashboardPanel.classList.remove('hidden');
  participationPanel.classList.remove('hidden');
  await fetchDashboardData();
});
