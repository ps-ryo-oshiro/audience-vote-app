const adminLoginForm = document.getElementById('admin-login-form');
const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const uploadPanel = document.getElementById('upload-panel');
const loginMessage = document.getElementById('login-message');
const uploadMessage = document.getElementById('upload-message');
const winnerName = document.getElementById('winner-name');
const toggleVotingStatus = document.getElementById('toggle-voting-status');
const uploadForm = document.getElementById('upload-form');
const summaryTableWrap = document.getElementById('summary-table-wrap');
const globalResultsBody = document.getElementById('global-results-body');

const adminState = {
  loggedIn: false,
  teams: [],
  isOpen: true
};

const DEFAULT_TEAMS = [
  { id: 'team-life-1', title: 'ライフサポートアプリ', section: 'life', videoUrl: 'https://example.com/video/life' },
  { id: 'team-life-2', title: '健康管理アプリ', section: 'life', videoUrl: 'https://example.com/video/health' },
  { id: 'team-work-1', title: '業務効率化ツール', section: 'work', videoUrl: 'https://example.com/video/work' },
  { id: 'team-work-2', title: 'コミュニケーション支援', section: 'work', videoUrl: 'https://example.com/video/comm' },
  { id: 'team-local-1', title: '地域活性化アプリ', section: 'local', videoUrl: 'https://example.com/video/local' },
  { id: 'team-local-2', title: 'まちのおすすめ案内', section: 'local', videoUrl: 'https://example.com/video/local2' }
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
    return `<tr><td>${team.title}</td><td>${team.section}</td><td>${count}</td></tr>`;
  }).join('');

  globalResultsBody.innerHTML = rows || '<tr><td colspan="3">データなし</td></tr>';
}

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
  uploadPanel.classList.remove('hidden');
  await fetchDashboardData();
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage(uploadMessage);

  const fileInput = document.getElementById('upload-file');
  const file = fileInput.files[0];
  if (!file) {
    showMessage(uploadMessage, 'CSV / Excel ファイルを選択してください。', 'error');
    return;
  }

  try {
    const data = await readUploadFile(file);
    const validation = validateRows(data);
    if (!validation.ok) {
      showMessage(uploadMessage, validation.message, 'error');
      return;
    }

    if (isFirebaseConfigured()) {
      const db = ensureFirebase();
      const teamMap = {};
      for (const row of validation.rows) {
        const key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        teamMap[key] = {
          title: row.title,
          section: row.section,
          videoUrl: row.video_url
        };
      }

      await db.ref('audienceApp/teams').set(teamMap);
    } else {
      const storedTeams = getLocalStorageData('teams', DEFAULT_TEAMS);
      const updatedTeams = [...storedTeams];
      const newTeams = validation.rows.map((row, index) => ({
        id: `uploaded-${Date.now()}-${index}`,
        title: row.title,
        section: row.section,
        videoUrl: row.video_url
      }));
      setLocalStorageData('teams', [...updatedTeams, ...newTeams]);
    }

    showMessage(uploadMessage, `${validation.rows.length}件のデータを登録しました。`, 'success');
    await fetchDashboardData();
  } catch (error) {
    console.error(error);
    showMessage(uploadMessage, `取り込みに失敗しました: ${error.message}`, 'error');
  }
});

function readUploadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const arrayBuffer = event.target.result;
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.readAsArrayBuffer(file);
  });
}

function validateRows(rows) {
  const required = ['section', 'title', 'video_url'];
  const normalized = rows.map((row) => {
    const fixed = {};
    Object.keys(row).forEach((key) => {
      fixed[String(key).trim()] = String(row[key]).trim();
    });
    return fixed;
  });

  const validRows = normalized
    .filter((row) => required.every((field) => row[field]))
    .map((row) => ({
      section: row.section,
      title: row.title,
      video_url: row.video_url
    }));

  if (!validRows.length) {
    return { ok: false, message: 'CSV/Excel の列名は section, title, video_url を含む必要があります。', rows: [] };
  }

  return { ok: true, rows: validRows };
}
