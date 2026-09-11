const adminLoginForm = document.getElementById('admin-login-form');
const loginPanel = document.getElementById('login-panel');
const dashboardPanel = document.getElementById('dashboard-panel');
const loginMessage = document.getElementById('login-message');
const winnerName = document.getElementById('winner-name');
const toggleVotingStatus = document.getElementById('toggle-voting-status');
const summaryTableWrap = document.getElementById('summary-table-wrap');
const globalResultsBody = document.getElementById('global-results-body');
const totalVotesCount = document.getElementById('total-votes-count');
const excludedVotesNote = document.getElementById('excluded-votes-note');
const supersededVotesNote = document.getElementById('superseded-votes-note');

const participationPanel = document.getElementById('participation-panel');
const participationCounter = document.getElementById('participation-counter');
const participationMessage = document.getElementById('participation-message');
const finalistListBody = document.getElementById('finalist-list-body');
const candidateListBody = document.getElementById('candidate-list-body');

const adminState = {
  loggedIn: false,
  teams: [],
  votes: [],
  supersededCount: 0,
  isOpen: true,
  subscribed: false,
  // 表示切替パネルを直前に組み立てたときの「顔ぶれ・名称・並び」の署名。
  // teams が変わっても、この署名が同じなら表示切替パネルは組み直さない（3.3）
  participationSignature: null
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

function byEntryNo(a, b) {
  const aNo = typeof a.entryNo === 'number' ? a.entryNo : Infinity;
  const bNo = typeof b.entryNo === 'number' ? b.entryNo : Infinity;
  return aNo - bNo;
}

/* 得票数の多い順、同数はNo順（5.1・5.5） */
function sortByCountThenNo(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return byEntryNo(a, b);
}

/* 同数は同順位とし、次の順位は飛ばす（1位, 1位, 3位）（5.5） */
function assignRanks(sortedItems) {
  let rank = 0;
  let lastCount = null;
  return sortedItems.map((item, index) => {
    if (lastCount === null || item.count !== lastCount) {
      rank = index + 1;
      lastCount = item.count;
    }
    return { ...item, rank };
  });
}

/* やり直しに対応するため、票は追記のまま残り、同一投票者の票が複数存在しうる。
   同一 voterToken のうち votedAt が最新の1件だけを有効票とし、同時刻ならキー（時系列で単調増加する）の
   大きいものを選ぶ。voterToken を持たない票は他と同一視せず、そのまま1件の有効票として扱う。
   集計に使う票は必ずこの関数を通すこと（通さない経路を作ると票が二重計上される） */
function selectEffectiveVotes(records) {
  const latestByToken = new Map();
  const standalone = [];

  records.forEach((record) => {
    const token = record && record.voterToken;
    if (!token) {
      standalone.push(record);
      return;
    }

    const current = latestByToken.get(token);
    if (!current || isNewerVote(record, current)) {
      latestByToken.set(token, record);
    }
  });

  const votes = standalone.concat(Array.from(latestByToken.values()));
  return { votes, supersededCount: records.length - votes.length };
}

function isNewerVote(candidate, current) {
  const candidateAt = typeof candidate.votedAt === 'number' ? candidate.votedAt : -Infinity;
  const currentAt = typeof current.votedAt === 'number' ? current.votedAt : -Infinity;
  if (candidateAt !== currentAt) return candidateAt > currentAt;
  return String(candidate.key) > String(current.key);
}

/* どのチームにも一致しない teamId の票は、チームの得票には数えず「集計対象外」として件数だけ示す */
function computeVoteCounts(teams, votes) {
  const countsById = new Map();
  teams.forEach((team) => countsById.set(team.id, 0));

  let excludedCount = 0;
  votes.forEach((vote) => {
    if (countsById.has(vote.teamId)) {
      countsById.set(vote.teamId, countsById.get(vote.teamId) + 1);
    } else {
      excludedCount += 1;
    }
  });

  return { countsById, excludedCount, totalVotes: votes.length };
}

function renderSummaryTable(teams, votes) {
  const { countsById } = computeVoteCounts(teams, votes);
  const sectionGroups = { life: [], local: [], work: [] };

  teams.forEach((team) => {
    if (sectionGroups[team.section]) {
      sectionGroups[team.section].push({
        id: team.id,
        entryNo: team.entryNo,
        title: team.title,
        count: countsById.get(team.id) || 0
      });
    }
  });

  const sectionRows = Object.entries(sectionGroups)
    .map(([section, list]) => {
      const sorted = list.slice().sort(sortByCountThenNo);
      const rows = sorted.map((item) => {
        const no = typeof item.entryNo === 'number' ? item.entryNo : '-';
        return `<tr><td>${no}</td><td>${escapeHtml(item.title)}</td><td>${item.count}</td></tr>`;
      }).join('');

      return `
        <div style="margin-bottom: 24px;">
          <h4>${SECTION_LABELS[section] || section}</h4>
          <table>
            <thead><tr><th>No</th><th>アプリ名</th><th>得票数</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">データなし</td></tr>'}</tbody>
          </table>
        </div>
      `;
    }).join('');

  summaryTableWrap.innerHTML = sectionRows || '<div class="empty-box">集計対象のアプリがありません。</div>';
}

function renderGlobalResults(teams, votes) {
  const { countsById, excludedCount, totalVotes } = computeVoteCounts(teams, votes);

  const ranked = assignRanks(
    teams
      .map((team) => ({
        id: team.id,
        entryNo: team.entryNo,
        title: team.title,
        section: team.section,
        count: countsById.get(team.id) || 0
      }))
      .sort(sortByCountThenNo)
  );

  const rows = ranked.map((item) => {
    const no = typeof item.entryNo === 'number' ? item.entryNo : '-';
    return `<tr>
      <td>${item.rank}</td>
      <td>${no}</td>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(SECTION_LABELS[item.section] || item.section)}</td>
      <td>${item.count}</td>
    </tr>`;
  }).join('');

  globalResultsBody.innerHTML = rows || '<tr><td colspan="5">データなし</td></tr>';

  if (totalVotesCount) {
    totalVotesCount.textContent = String(totalVotes);
  }

  if (excludedVotesNote) {
    if (excludedCount > 0) {
      excludedVotesNote.textContent = `（集計対象外 ${excludedCount}件）`;
      excludedVotesNote.classList.remove('hidden');
    } else {
      excludedVotesNote.textContent = '';
      excludedVotesNote.classList.add('hidden');
    }
  }

  if (supersededVotesNote) {
    if (adminState.supersededCount > 0) {
      supersededVotesNote.textContent = `（やり直しにより無効 ${adminState.supersededCount}件）`;
      supersededVotesNote.classList.remove('hidden');
    } else {
      supersededVotesNote.textContent = '';
      supersededVotesNote.classList.add('hidden');
    }
  }
}

function determineWinner(teams, votes) {
  if (!teams.length) {
    winnerName.textContent = '未判定';
    return;
  }

  const { countsById } = computeVoteCounts(teams, votes);
  const maxCount = teams.reduce((max, team) => Math.max(max, countsById.get(team.id) || 0), 0);

  if (maxCount === 0) {
    winnerName.textContent = '未判定';
    return;
  }

  const winners = teams
    .filter((team) => (countsById.get(team.id) || 0) === maxCount)
    .slice()
    .sort(byEntryNo);

  winnerName.textContent = winners.length > 1
    ? `同票: ${winners.map((team) => team.title).join('、')}`
    : winners[0].title;
}

/* 有効票の絞り込みはここで1度だけ行い、以降の描画はすべて同じ結果を受け取る */
function renderAggregates() {
  const { votes, supersededCount } = selectEffectiveVotes(adminState.votes);
  adminState.supersededCount = supersededCount;

  renderGlobalResults(adminState.teams, votes);
  renderSummaryTable(adminState.teams, votes);
  determineWinner(adminState.teams, votes);
}

function byEntryNoAndId(a, b) {
  const diff = byEntryNo(a, b);
  if (diff !== 0) return diff;
  return String(a.id).localeCompare(String(b.id));
}

/* 表示切替パネルを組み直す必要があるかどうかの署名。participating は含めない
   （票と同じく、参加状態の変化だけでは表示切替パネルを組み直さないため） */
function participationSignature(teams) {
  return JSON.stringify(
    teams
      .slice()
      .sort(byEntryNoAndId)
      .map((team) => ({
        id: team.id,
        entryNo: team.entryNo,
        title: team.title,
        section: team.section,
        finalist: team.finalist === true
      }))
  );
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

/* teams の顔ぶれ・名称・並びは変わっていない（participating だけが変わった）場合に、
   一覧を組み直さずチェック状態と表示中の数だけを更新する */
function updateParticipationCheckboxStates(teams) {
  const byId = new Map(teams.map((team) => [team.id, team]));
  candidateListBody.querySelectorAll('.participating-toggle').forEach((input) => {
    const team = byId.get(input.dataset.teamId);
    if (team) {
      input.checked = team.participating === true;
    }
  });
  updateParticipationCounter();
}

function updateParticipationCounter() {
  const candidates = computeCandidates(adminState.teams);
  const shown = candidates.filter((team) => isVisibleTeam(team)).length;
  participationCounter.textContent = `${shown} / ${candidates.length}`;
}

/* teams の更新を受け取る共通の入口（Firebase購読・デモモードの再描画の両方から呼ぶ）。
   集計パネルは常に全チームで作り直すが、表示切替パネルは組成が変わったときだけ組み直す */
function handleTeamsUpdate(teams) {
  adminState.teams = teams;
  const signature = participationSignature(teams);
  if (signature !== adminState.participationSignature) {
    adminState.participationSignature = signature;
    renderParticipationPanel(teams);
  } else {
    updateParticipationCheckboxStates(teams);
  }
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

function updateVotingToggle() {
  toggleVotingStatus.textContent = adminState.isOpen ? '投票を停止する' : '投票を開始する';
  toggleVotingStatus.className = `secondary-button ${adminState.isOpen ? 'open' : 'closed'}`;
}

/* Firebase使用時: teams・votes・settings を on('value') で購読する（5.6）。
   変化があるたびにコールバックが呼ばれ、集計パネルと受付ボタンの表示を更新する */
function subscribeToFirebase(db) {
  if (adminState.subscribed) return;
  adminState.subscribed = true;

  db.ref('audienceApp/teams').on('value', (snapshot) => {
    const teams = Object.entries(snapshot.val() || {}).map(([id, team]) => ({ id, ...team }));
    handleTeamsUpdate(teams);
    renderAggregates();
  }, (error) => {
    console.error('teams の購読でエラーが発生しました。', error);
  });

  db.ref('audienceApp/votes').on('value', (snapshot) => {
    /* 同一時刻の票の順序を決めるため、プッシュキーを保持する */
    adminState.votes = Object.entries(snapshot.val() || {}).map(([key, vote]) => ({ key, ...vote }));
    renderAggregates();
  }, (error) => {
    console.error('votes の購読でエラーが発生しました。', error);
  });

  db.ref('audienceApp/settings').on('value', (snapshot) => {
    const settings = snapshot.val() || {};
    adminState.isOpen = !!settings.isOpen;
    updateVotingToggle();
  }, (error) => {
    console.error('settings の購読でエラーが発生しました。', error);
  });
}

/* デモモード（localStorage）: on('value') に相当する仕組みがないため、
   入室時と操作のたびに、ブラウザ内のデータから再描画する */
function fetchDashboardData() {
  const teams = getLocalStorageData('teams', DEFAULT_TEAMS);
  const votes = getLocalStorageData('votes', []);
  const settings = getLocalStorageData('settings', { isOpen: true });

  /* デモモードの票は配列。並び順の位置をキーとして扱う */
  adminState.votes = votes.map((vote, index) => ({ key: String(index).padStart(6, '0'), ...vote }));
  adminState.isOpen = !!settings.isOpen;
  handleTeamsUpdate(teams);
  renderAggregates();
  updateVotingToggle();
}

toggleVotingStatus.addEventListener('click', async () => {
  if (!adminState.loggedIn) return;

  const nextState = !adminState.isOpen;

  if (isFirebaseConfigured()) {
    const db = ensureFirebase();
    await db.ref('audienceApp/settings').set({ isOpen: nextState });
    // 購読（on('value')）が settings の変化を受けて updateVotingToggle() を呼ぶため、ここでの手動更新は不要
  } else {
    setLocalStorageData('settings', { isOpen: nextState });
    adminState.isOpen = nextState;
    updateVotingToggle();
  }
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

  if (isFirebaseConfigured()) {
    subscribeToFirebase(ensureFirebase());
  } else {
    fetchDashboardData();
  }
});
