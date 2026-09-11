/* =========================================================
   オーディエンス投票 — 投票画面ロジック
   データ層: Firebase / localStorage フォールバック・voterToken・
   /api/vote への二重投票判定を担う。
   UI層: テーマ切替・送信アニメーション・完了オーバーレイを担う。
   ========================================================= */

/* imagePosition: band__visual の background-position。画像ごとに人物の構図が異なるため個別指定する */
const SECTIONS = [
  { key: 'life', name: 'ライフ部門', code: 'LIFE', no: '01', tagline: '暮らしの不便を解消する', image: 'assets/images/categories/life.webp', imagePosition: 'center 30%' },
  { key: 'local', name: 'ローカル部門', code: 'LOCAL', no: '02', tagline: '沖縄固有の不便を解消する', image: 'assets/images/categories/local.webp', imagePosition: 'center top' },
  { key: 'work', name: 'ワーク部門', code: 'WORK', no: '03', tagline: 'シゴトの不便を解消する', image: 'assets/images/categories/work.webp', imagePosition: 'center top' }
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
  activeSection: SECTIONS[0].key,
  phase: PHASE.IDLE
};

const voteForm = document.getElementById('vote-form');
const sectionList = document.getElementById('section-list');
const voteStatusBadge = document.getElementById('vote-status-badge');
const voteMessage = document.getElementById('vote-message');
const voteSubmit = document.getElementById('vote-submit');
const voteSubmitLabel = document.getElementById('vote-submit-label');
const voteRedoInline = document.getElementById('vote-redo-inline');
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

/* youtu.be / youtube.com の各種URL形式から動画IDを取り出し、
   常に自前のiframe属性で埋め込みURLを組み立てる（DBの値をそのままiframe化しない）。
   YouTube以外・ID形式が不正な場合はnullを返し、通常の外部リンク表示にフォールバックする。 */
function getYoutubeEmbedUrl(value) {
  const href = safeVideoUrl(value);
  if (href === '#') return null;
  let url;
  try {
    url = new URL(href);
  } catch (error) {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1);
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else if (url.pathname.startsWith('/embed/')) {
      id = url.pathname.slice('/embed/'.length);
    } else if (url.pathname.startsWith('/shorts/')) {
      id = url.pathname.slice('/shorts/'.length);
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
}

function isLocked() {
  return !appState.isOpen || appState.hasVoted || appState.phase !== PHASE.IDLE;
}

function sectionAccentStyle(key) {
  return `--section-accent: var(--band-accent-${escapeHtml(key)})`;
}

function renderTeams() {
  let index = 0;

  const blocksHtml = SECTIONS.map((section) => {
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
        <div class="band" style="${sectionAccentStyle(section.key)}">
          <div class="band__info">
            <span class="band__no">CATEGORY ${escapeHtml(section.no)}</span>
            <span class="band__name">${escapeHtml(section.name)}</span>
            <span class="band__tagline">〜 ${escapeHtml(section.tagline)} 〜</span>
          </div>
          <span class="band__code">${escapeHtml(section.code)}</span>
        </div>
        <div class="band__visual" style="background-image:url('${escapeHtml(section.image)}');background-position:${escapeHtml(section.imagePosition)}">
          <span class="band__visual-overlay" aria-hidden="true"></span>
        </div>
      </div>`;

    const isActive = section.key === appState.activeSection;
    const panelAttrs = `data-section="${escapeHtml(section.key)}" role="tabpanel" id="panel-${escapeHtml(section.key)}" aria-labelledby="tab-${escapeHtml(section.key)}"`;

    if (!teams.length) {
      return `<div class="section-block${isActive ? ' is-tab-active' : ''}" ${panelAttrs}>${band}<div class="empty-box">エントリーがありません。</div></div>`;
    }

    const cards = teams.map((team) => {
      index += 1;
      const delay = (0.12 + index * 0.06).toFixed(2);
      const displayTitle = typeof team.entryNo === 'number' ? `No.${team.entryNo} ${team.title}` : team.title;
      const videoHref = safeVideoUrl(team.videoUrl);
      const embedUrl = getYoutubeEmbedUrl(team.videoUrl);
      const videoLink = !embedUrl && videoHref !== '#'
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
          ${embedUrl ? `<span class="entry__player"><iframe src="${escapeHtml(embedUrl)}" title="紹介動画" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></span>` : ''}
          <span class="entry__foot">
            ${videoLink}
            <span class="entry__mark" aria-hidden="true">SELECTED</span>
          </span>
        </label>`;
    }).join('');

    return `<div class="section-block${isActive ? ' is-tab-active' : ''}" ${panelAttrs}>${band}<div class="section-block__list">${cards}</div></div>`;
  }).join('');

  const tabsHtml = `
    <div class="vote-tabs" role="tablist" aria-label="部門切り替え">
      ${SECTIONS.map((section) => {
        const isActive = section.key === appState.activeSection;
        return `
          <button type="button" class="vote-tabs__btn${isActive ? ' is-active' : ''}" style="${sectionAccentStyle(section.key)}" role="tab" id="tab-${escapeHtml(section.key)}" aria-controls="panel-${escapeHtml(section.key)}" aria-selected="${isActive}" data-section-tab="${escapeHtml(section.key)}">
            <span class="vote-tabs__label">${escapeHtml(section.name)}</span>
            <span class="vote-tabs__dot" aria-hidden="true"></span>
          </button>`;
      }).join('')}
    </div>`;

  sectionList.innerHTML = tabsHtml + blocksHtml;
  if (entryCount) entryCount.textContent = `全${appState.teams.length}エントリー`;
  updateVoteStatus();
}

/* モバイルのタブ切り替え。768px以上はCSS側で常時全部門表示に戻すため無効化される */
function setActiveSection(key) {
  if (appState.activeSection === key) return;
  appState.activeSection = key;

  document.querySelectorAll('.vote-tabs__btn').forEach((btn) => {
    const active = btn.dataset.sectionTab === key;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('.section-block').forEach((block) => {
    const active = block.dataset.section === key;
    block.classList.toggle('is-tab-active', active);
  });
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

  const selectedTeam = appState.teams.find((team) => team.id === appState.selectedId);
  document.querySelectorAll('.vote-tabs__btn').forEach((btn) => {
    btn.classList.toggle('has-selection', !!selectedTeam && selectedTeam.section === btn.dataset.sectionTab);
  });

  setLoaderVisible(sending);
  voteSubmit.classList.toggle('is-sending', sending);
  voteSubmit.disabled = locked || !appState.selectedId;
  voteSubmitLabel.innerHTML = submitLabelHtml(sending);
  voteRedoInline.classList.toggle('hidden', !(appState.hasVoted && canRedo()));
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

/* 受付中は何度でもやり直せる。
   受付状態の判定は、締め切り後に画面を開き直した場合に備えた防御で、サーバー側の拒否と二重で機能する */
function canRedo() {
  return appState.isOpen;
}

/* やり直し操作はトップページの送信ボタン横に常駐させるため、完了画面には戻るリンクだけ置く */
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
        <button type="button" class="done-back-btn" id="done-back">トップページへ戻る</button>
      </div>
    </div>
    <span class="done-overlay__band done-overlay__band--bottom" aria-hidden="true"></span>`;

  document.body.appendChild(overlay);
  overlay.querySelector('#done-back').addEventListener('click', removeDoneOverlay);
}

function removeDoneOverlay() {
  document.querySelector('.done-overlay')?.remove();
}

/* やり直し: 完了画面を閉じ、未投票と同じ操作可能状態に戻す。
   voterToken は再生成しない（再生成すると前の票を無効化できず票数が増えてしまう） */
function enterRedoMode() {
  removeDoneOverlay();
  localStorage.removeItem(VOTE_SUBMITTED_KEY);
  appState.hasVoted = false;
  appState.selectedId = null;
  appState.phase = PHASE.IDLE;
  hideMessage();
  updateVoteStatus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

voteRedoInline.addEventListener('click', enterRedoMode);

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

/* タブ切り替え専用のクリックハンドラ。動画は常時インライン表示のため開閉処理は不要 */
sectionList.addEventListener('click', (event) => {
  const tabBtn = event.target.closest('.vote-tabs__btn');
  if (tabBtn) {
    setActiveSection(tabBtn.dataset.sectionTab);
  }
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
        /* 403 は受付終了と表示対象外チームの双方で使うため、ステータスではなくエラーコードで分岐する */
        if (payload.error === 'voting_closed') {
          localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
          appState.isOpen = false;
          applyVotedUiState('投票受付は終了しました。直前の投票が有効です。');
          return;
        }
        throw new Error(payload.error || '投票の受付に失敗しました。');
      }

      localStorage.setItem(VOTE_SUBMITTED_KEY, 'true');
      playDoneSequence(team.title || '');
      return;
    }

    const votes = getLocalStorageData('votes', []);
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
      showMessage(
        appState.isOpen
          ? '投票済みです。やり直す場合は下の「投票をやり直す」ボタンから選び直せます。'
          : '投票済みです。投票受付は終了しました。',
        'success'
      );
    }
  } catch (error) {
    console.error(error);
    showMessage(`読み込みに失敗しました。ページを再読み込みしてください。（${error.message}）`, 'error');
  }
})();
