/* =========================================================
   オーディエンス投票 — 投票画面ロジック
   データ層: Firebase / localStorage フォールバック・voterToken・
   /api/vote への二重投票判定を担う。
   UI層: テーマ切替・送信アニメーション・完了オーバーレイを担う。
   ========================================================= */

const SECTIONS = [
  { key: 'life', name: 'ライフ部門', code: 'LIFE' },
  { key: 'work', name: 'ワーク部門', code: 'WORK' },
  { key: 'local', name: 'ローカル部門', code: 'LOCAL' }
];

const DEFAULT_TEAMS = [
  { id: 'entry-01', entryNo: 1, title: 'ライフサポートアプリ', section: 'life', videoUrl: 'https://example.com/video/entry-01', finalist: true, participating: true },
  { id: 'entry-02', entryNo: 2, title: '健康管理アプリ', section: 'life', videoUrl: 'https://example.com/video/entry-02', finalist: false, participating: false },
  { id: 'entry-03', entryNo: 3, title: '業務効率化ツール', section: 'work', videoUrl: 'https://example.com/video/entry-03', finalist: true, participating: true },
  { id: 'entry-04', entryNo: 4, title: 'コミュニケーション支援', section: 'work', videoUrl: 'https://example.com/video/entry-04', finalist: false, participating: true },
  { id: 'entry-05', entryNo: 5, title: '地域活性化アプリ', section: 'local', videoUrl: 'https://example.com/video/entry-05', finalist: true, participating: false },
  { id: 'entry-06', entryNo: 6, title: 'まちのおすすめ案内', section: 'local', videoUrl: '', finalist: false, participating: false }
];

const THEME_KEY = 'audienceVote:theme';
const VOTE_SUBMITTED_KEY = 'audience-vote-submitted';
const SENDING_MS = 1200;
const PHASE = { IDLE: 'idle', SENDING: 'sending' };

const appState = {
  isOpen: true,
  teams: DEFAULT_TEAMS,
  hasVoted: false,
  selectedId: null,
  phase: PHASE.IDLE
};

const voteForm = document.getElementById('vote-form');
const sectionList = document.getElementById('section-list');
const voteStatusBadge = document.getElementById('vote-status-badge');
const voteMessage = document.getElementById('vote-message');
const voteSubmit = document.getElementById('vote-submit');
const voteSubmitLabel = document.getElementById('vote-submit-label');
const entryCount = document.getElementById('entry-count');
const submitBar = document.querySelector('.submit-bar');

/* ---------------- テーマ（ライト / ダーク） ---------------- */

function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#061a4d' : '#ffffff');
  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    const active = btn.dataset.themeSet === next;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (error) { saved = null; }
  applyTheme(saved === 'dark' || saved === 'light' ? saved : 'light');

  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.themeSet;
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (error) { /* ignore */ }
    });
  });
}

/* ---------------- メッセージ ---------------- */

function showMessage(text, type) {
  voteMessage.textContent = text;
  voteMessage.className = `vote-message${type === 'error' ? ' is-error' : ''}`;
}

function hideMessage() {
  voteMessage.textContent = '';
  voteMessage.className = 'vote-message hidden';
}

/* ---------------- データ層 ---------------- */

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

/* 表示判定。3か所で揃える判定規則。app.js・admin.js・worker.js で同じ内容にすること */
function isVisibleTeam(team) {
  return !!team && (team.finalist === true || team.participating === true);
}

async function readTeams(db) {
  if (!isFirebaseConfigured()) {
    appState.teams = getLocalStorageData('teams', DEFAULT_TEAMS).filter(isVisibleTeam);
    renderTeams();
    return;
  }
  const snapshot = await db.ref('audienceApp/teams').once('value');
  const teams = snapshot.val() || {};
  appState.teams = Object.entries(teams)
    .map(([id, team]) => ({ id, ...team }))
    .filter(isVisibleTeam);
  renderTeams();
}

/* ---------------- 描画 ---------------- */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* javascript: 等のスキームを弾き、http/https のURLだけを許可する */
function safeVideoUrl(value) {
  if (!value) return '#';
  try {
    const url = new URL(String(value), window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch (error) {
    return '#';
  }
}

function isLocked() {
  return !appState.isOpen || appState.hasVoted || appState.phase !== PHASE.IDLE;
}

function renderTeams() {
  let index = 0;

  const html = SECTIONS.map((section) => {
    const teams = appState.teams
      .filter((team) => team.section === section.key)
      .slice()
      .sort((a, b) => {
        const aNo = typeof a.entryNo === 'number' ? a.entryNo : Infinity;
        const bNo = typeof b.entryNo === 'number' ? b.entryNo : Infinity;
        return aNo - bNo;
      });
    const band = `
      <div class="band-clip">
        <div class="band">
          <span class="band__name">${escapeHtml(section.name)}</span>
          <span class="band__code">${escapeHtml(section.code)}</span>
        </div>
      </div>`;

    if (!teams.length) {
      return `<div class="section-block">${band}<div class="empty-box">エントリーがありません。</div></div>`;
    }

    const cards = teams.map((team) => {
      index += 1;
      const delay = (0.12 + index * 0.06).toFixed(2);
      const displayTitle = typeof team.entryNo === 'number' ? `No.${team.entryNo} ${team.title}` : team.title;
      const videoHref = safeVideoUrl(team.videoUrl);
      const videoLink = videoHref !== '#'
        ? `<a class="entry__video" href="${escapeHtml(videoHref)}" target="_blank" rel="noopener noreferrer">VIDEO</a>`
        : '';
      return `
        <label class="entry" data-team-id="${escapeHtml(team.id)}" style="animation-delay:${delay}s">
          <span class="entry__shard" aria-hidden="true"></span>
          <span class="entry__head">
            <span class="entry__title">${escapeHtml(displayTitle)}</span>
            <input class="entry__radio" type="radio" name="teamId" value="${escapeHtml(team.id)}" />
            <span class="entry__box" aria-hidden="true"></span>
          </span>
          <span class="entry__foot">
            ${videoLink}
            <span class="entry__mark" aria-hidden="true">SELECTED</span>
          </span>
        </label>`;
    }).join('');

    return `<div class="section-block">${band}<div class="section-block__list">${cards}</div></div>`;
  }).join('');

  sectionList.innerHTML = html;
  if (entryCount) entryCount.textContent = `全${appState.teams.length}エントリー`;
  updateVoteStatus();
}

function submitLabelHtml(sending) {
  if (sending) return '<span class="submit-btn__spinner" aria-hidden="true"></span>送信中';
  if (appState.hasVoted) return '送信完了';
  if (!appState.isOpen) return '受付は終了しました';
  return appState.selectedId ? '投票を送信する' : 'アプリを選択してください';
}

function updateVoteStatus() {
  const locked = isLocked();
  const sending = appState.phase === PHASE.SENDING;

  if (voteStatusBadge) {
    voteStatusBadge.className = `status-pill${appState.isOpen ? '' : ' is-closed'}`;
    voteStatusBadge.innerHTML = `<i class="status-pill__dot"></i>${appState.isOpen ? '受付中' : '受付終了'}`;
  }

  document.querySelectorAll('.entry').forEach((entry) => {
    const radio = entry.querySelector('input[name="teamId"]');
    const selected = entry.dataset.teamId === appState.selectedId;
    entry.classList.toggle('is-selected', selected);
    entry.classList.toggle('is-disabled', locked);
    if (radio) {
      radio.checked = selected;
      radio.disabled = locked;
    }
  });

  setLoaderVisible(sending);
  voteSubmit.classList.toggle('is-sending', sending);
  voteSubmit.disabled = locked || !appState.selectedId;
  voteSubmitLabel.innerHTML = submitLabelHtml(sending);
}

function setLoaderVisible(visible) {
  const existing = submitBar.querySelector('.submit-bar__loader');
  if (visible && !existing) {
    const loader = document.createElement('div');
    loader.className = 'submit-bar__loader';
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML = '<span></span>';
    submitBar.appendChild(loader);
  } else if (!visible && existing) {
    existing.remove();
  }
}

/* ---------------- 投票完了オーバーレイ ---------------- */

function showDoneOverlay(title) {
  if (document.querySelector('.done-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'done-overlay';
  overlay.setAttribute('role', 'alert');
  overlay.innerHTML = `
    <span class="done-overlay__band done-overlay__band--top" aria-hidden="true"></span>
    <div class="done-overlay__body">
      <span class="done-overlay__streak done-overlay__streak--1" aria-hidden="true"></span>
      <span class="done-overlay__streak done-overlay__streak--2" aria-hidden="true"></span>
      <div class="done-overlay__col">
        <span class="done-check" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#061a4d" stroke-width="3.2" stroke-linecap="square"></path></svg>
        </span>
        <div class="done-title-wrap">
          <div class="done-title">投票完了</div>
          <span class="done-rule" aria-hidden="true"></span>
        </div>
        <p class="done-lead">あなたの1票を受け付けました。<br />結果発表をお楽しみください。</p>
        <div class="done-card">
          <span class="done-card__label">YOUR VOTE</span>
          <span class="done-card__value">${escapeHtml(title)}</span>
        </div>
      </div>
    </div>
    <span class="done-overlay__band done-overlay__band--bottom" aria-hidden="true"></span>`;

  document.body.appendChild(overlay);
}

/* 送信成功時の演出。呼び出し側で phase = SENDING にした後に呼ぶ。ローディング → 完了オーバーレイ */
function playDoneSequence(title) {
  setTimeout(() => {
    appState.phase = PHASE.IDLE;
    appState.hasVoted = true;
    updateVoteStatus();
    showDoneOverlay(title);
  }, SENDING_MS);
}

function applyVotedUiState(messageText) {
  appState.hasVoted = true;
  appState.phase = PHASE.IDLE;
  updateVoteStatus();
  showMessage(messageText || '投票済みです。再送信はできません。', 'success');
}

/* ---------------- イベント ---------------- */

/* ラベルクリックは change に転送される（動画リンクなど内部の対話的要素への
   クリックは転送されない）ため、change だけで選択を拾えば十分 */
sectionList.addEventListener('change', (event) => {
  if (event.target.name !== 'teamId' || isLocked()) return;
  appState.selectedId = event.target.value;
  hideMessage();
  updateVoteStatus();
});

voteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideMessage();

  if (!appState.isOpen) {
    showMessage('投票受付は停止中です。', 'error');
    return;
  }

  if (appState.phase !== PHASE.IDLE) return;

  if (appState.hasVoted || localStorage.getItem(VOTE_SUBMITTED_KEY) === 'true') {
    applyVotedUiState('投票済みです。再送信はできません。');
    return;
  }

  const teamId = appState.selectedId;
  if (!teamId) {
    showMessage('投票先のアプリを選択してください。', 'error');
    return;
  }

  const team = appState.teams.find((item) => item.id === teamId) || {};
  const voterToken = getVoterToken();

  appState.phase = PHASE.SENDING;
  updateVoteStatus();

  try {
    if (isFirebaseConfigured()) {
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, voterToken })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409 || payload.error === 'already_voted') {
          localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
          applyVotedUiState('この端末ではすでに投票済みです。');
          return;
        }
        throw new Error(payload.error || '投票の受付に失敗しました。');
      }

      localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
      playDoneSequence(team.title || '');
      return;
    }

    const votes = getLocalStorageData('votes', []);
    if (votes.some((vote) => vote.voterToken === voterToken)) {
      localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
      applyVotedUiState('この端末ではすでに投票済みです。');
      return;
    }
    votes.push({ teamId, voterToken, votedAt: Date.now() });
    setLocalStorageData('votes', votes);
    localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
    playDoneSequence(team.title || '');
  } catch (error) {
    console.error(error);
    appState.phase = PHASE.IDLE;
    updateVoteStatus();
    showMessage(`投票に失敗しました: ${error.message}`, 'error');
  }
});

/* ---------------- 起動 ---------------- */

initTheme();

(async () => {
  try {
    if (localStorage.getItem(VOTE_SUBMITTED_KEY) === 'true') {
      appState.hasVoted = true;
    }

    if (isFirebaseConfigured()) {
      const db = ensureFirebase();
      await Promise.all([readSettings(db), readTeams(db)]);
      /* 表示に必要なデータ（チーム一覧・受付状態）を読み終えたら、常時接続を持ち続けない（要件13.1） */
      db.goOffline();
    } else {
      await readSettings(null);
      await readTeams(null);
    }

    updateVoteStatus();

    if (appState.hasVoted) {
      showMessage('投票済みです。再送信はできません。', 'success');
    }
  } catch (error) {
    console.error(error);
    showMessage(`読み込みに失敗しました。ページを再読み込みしてください。（${error.message}）`, 'error');
  }
})();
