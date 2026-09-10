const SECTION_LABELS = {
  life: '🏡 ライフ部門',
  work: '💼 ワーク部門',
  local: '📍 ローカル部門'
};

const DEFAULT_TEAMS = [
  { id: 'team-life-1', title: 'ライフサポートアプリ', section: 'life', videoUrl: 'https://example.com/video/life', participating: true },
  { id: 'team-life-2', title: '健康管理アプリ', section: 'life', videoUrl: 'https://example.com/video/health', participating: true },
  { id: 'team-work-1', title: '業務効率化ツール', section: 'work', videoUrl: 'https://example.com/video/work', participating: true },
  { id: 'team-work-2', title: 'コミュニケーション支援', section: 'work', videoUrl: 'https://example.com/video/comm', participating: true },
  { id: 'team-local-1', title: '地域活性化アプリ', section: 'local', videoUrl: 'https://example.com/video/local', participating: true },
  { id: 'team-local-2', title: 'まちのおすすめ案内', section: 'local', videoUrl: 'https://example.com/video/local2', participating: true }
];

const appState = {
  isOpen: true,
  teams: DEFAULT_TEAMS,
  votes: [],
  hasVoted: false
};

const voteForm = document.getElementById('vote-form');
const sectionList = document.getElementById('section-list');
const voteStatusBadge = document.getElementById('vote-status-badge');
const voteMessage = document.getElementById('vote-message');

function applyVotedUiState(messageText) {
  appState.hasVoted = true;
  const radios = document.querySelectorAll('input[name="teamId"]');
  const submitButton = document.getElementById('vote-submit');
  radios.forEach((radio) => {
    radio.disabled = true;
  });
  if (submitButton) {
    submitButton.disabled = true;
  }
  showMessage(voteMessage, messageText || '投票済みです。再送信はできません。', 'success');
}

function clearVotedUiState() {
  appState.hasVoted = false;
  const radios = document.querySelectorAll('input[name="teamId"]');
  const submitButton = document.getElementById('vote-submit');
  radios.forEach((radio) => {
    radio.disabled = !appState.isOpen;
  });
  if (submitButton) {
    submitButton.disabled = !appState.isOpen;
  }
  hideMessage(voteMessage);
}

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

function getVoterToken() {
  const storageKey = 'audience-vote-token';
  let token = localStorage.getItem(storageKey);
  if (!token) {
    token = `voter-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    localStorage.setItem(storageKey, token);
  }
  return token;
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

async function readSettings(db) {
  if (!isFirebaseConfigured()) {
    appState.isOpen = getLocalStorageData('settings', { isOpen: true }).isOpen;
    updateVoteStatus();
    return;
  }

  const snapshot = await db.ref('audienceApp/settings').once('value');
  const settings = snapshot.val() || {};
  appState.isOpen = !!settings.isOpen;
  updateVoteStatus();
}

async function readTeams(db) {
  if (!isFirebaseConfigured()) {
    appState.teams = getLocalStorageData('teams', DEFAULT_TEAMS).filter((team) => team.participating === true);
    renderTeams();
    return;
  }

  const snapshot = await db.ref('audienceApp/teams').once('value');
  const teams = snapshot.val() || {};
  appState.teams = Object.entries(teams)
    .map(([id, team]) => ({ id, ...team }))
    .filter((team) => team.participating === true);
  renderTeams();
}

async function readVotes(db) {
  if (!isFirebaseConfigured()) {
    appState.votes = getLocalStorageData('votes', []);
    return;
  }

  const snapshot = await db.ref('audienceApp/votes').once('value');
  const votes = snapshot.val() || {};
  appState.votes = Object.values(votes);
}

function updateVoteStatus() {
  const isOpen = appState.isOpen;
  voteStatusBadge.textContent = isOpen ? '受付中' : '停止中';
  voteStatusBadge.className = `badge ${isOpen ? 'open' : 'closed'}`;
  const controls = document.querySelectorAll('input[name="teamId"], #vote-submit');
  const shouldDisable = !isOpen || appState.hasVoted || localStorage.getItem('audience-vote-submitted') === 'true';
  controls.forEach((el) => {
    el.disabled = shouldDisable;
  });
}

function renderTeams() {
  const grouped = {
    life: [],
    work: [],
    local: []
  };

  appState.teams.forEach((team) => {
    if (grouped[team.section]) {
      grouped[team.section].push(team);
    }
  });

  const items = Object.entries(SECTION_LABELS)
    .map(([section, label]) => {
      const teams = grouped[section] || [];
      if (!teams.length) {
        return `
          <div class="section-block">
            <h2>${label}</h2>
            <div class="empty-box">エントリーがありません。</div>
          </div>
        `;
      }

      return `
        <div class="section-block">
          <h2>${label}</h2>
          <div class="section-list">
            ${teams.map((team) => `
              <details class="app-details">
                <summary>${team.title}</summary>
                <div class="app-body">
                  <div class="vote-option">
                    <input type="radio" id="team-${team.id}" name="teamId" value="${team.id}" ${!appState.isOpen ? 'disabled' : ''} />
                    <label for="team-${team.id}">このアプリに投票する</label>
                  </div>
                  <div>
                    <a class="video-link" href="${team.videoUrl || '#'}" target="_blank" rel="noopener noreferrer">紹介動画を見る</a>
                  </div>
                </div>
              </details>
            `).join('')}
          </div>
        </div>
      `;
    })
    .join('');

  sectionList.innerHTML = items;
  updateVoteStatus();
}

voteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage(voteMessage);

  if (!appState.isOpen) {
    showMessage(voteMessage, '投票受付は停止中です。', 'error');
    return;
  }

  if (appState.hasVoted || localStorage.getItem('audience-vote-submitted') === 'true') {
    applyVotedUiState('投票済みです。再送信はできません。');
    return;
  }

  const selected = voteForm.querySelector('input[name="teamId"]:checked');
  if (!selected) {
    showMessage(voteMessage, '投票先のアプリを選択してください。', 'error');
    return;
  }

  const voterToken = getVoterToken();

  try {
    if (isFirebaseConfigured()) {
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          teamId: selected.value,
          voterToken
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409 || payload.error === 'already_voted') {
          localStorage.setItem('audience-vote-submitted', 'true');
          applyVotedUiState('この端末ではすでに投票済みです。');
          return;
        }
        throw new Error(payload.error || '投票の受付に失敗しました。');
      }

      localStorage.setItem('audience-vote-submitted', 'true');
      applyVotedUiState('✅ 送信完了');
      voteForm.reset();
      return;
    }

    const votes = getLocalStorageData('votes', []);
    if (votes.some((vote) => vote.voterToken === voterToken)) {
      localStorage.setItem('audience-vote-submitted', 'true');
      applyVotedUiState('この端末ではすでに投票済みです。');
      return;
    }
    votes.push({ teamId: selected.value, voterToken, votedAt: Date.now() });
    setLocalStorageData('votes', votes);
    localStorage.setItem('audience-vote-submitted', 'true');
    applyVotedUiState('✅ 送信完了');
    voteForm.reset();
  } catch (error) {
    console.error(error);
    showMessage(voteMessage, `投票に失敗しました: ${error.message}`, 'error');
  }
});

(async () => {
  try {
    if (localStorage.getItem('audience-vote-submitted') === 'true') {
      appState.hasVoted = true;
      applyVotedUiState('投票済みです。再送信はできません。');
    }

    if (isFirebaseConfigured()) {
      const db = ensureFirebase();
      await Promise.all([readSettings(db), readTeams(db), readVotes(db)]);
    } else {
      await readSettings(null);
      await readTeams(null);
      await readVotes(null);
    }

    updateVoteStatus();
  } catch (error) {
    console.error(error);
    showMessage(voteMessage, error.message, 'error');
  }
})();
