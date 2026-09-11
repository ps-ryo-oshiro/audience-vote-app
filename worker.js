/* 表示判定。3か所で揃える判定規則。app.js・admin.js・worker.js で同じ内容にすること */
function isVisibleTeam(team) {
  return !!team && (team.finalist === true || team.participating === true);
}

const VOTER_KEY_TTL_SECONDS = 60 * 60 * 24 * 30;

async function isVotingOpen(env) {
  const res = await fetch(`${env.FIREBASE_DB_URL}/audienceApp/settings/isOpen.json`);
  if (!res.ok) throw new Error('settings_fetch_failed');

  const isOpen = await res.json();
  /* 未設定（null）は受付中として扱う。クライアント側の既定値と揃える */
  return isOpen === null ? true : isOpen === true;
}

function voterKey(voterToken) {
  return `voter:${voterToken}`;
}

/* これまでに成功した送信回数。未投票・不正値はいずれも0として扱う。
   やり直しに上限はなく、この値は投票を拒否する判定には使わない（記録のみ）。
   旧実装が書いた固定値 '1' は「1回送信済み」として矛盾なく解釈される */
async function readAttemptCount(env, voterToken) {
  const raw = await env.AUDIENCE_VOTES.get(voterKey(voterToken));
  const count = Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function writeAttemptCount(env, voterToken, count) {
  await env.AUDIENCE_VOTES.put(voterKey(voterToken), String(count), { expirationTtl: VOTER_KEY_TTL_SECONDS });
}

async function getTeam(env, teamId) {
  if (!/^[A-Za-z0-9_-]+$/.test(teamId)) return null;

  const res = await fetch(`${env.FIREBASE_DB_URL}/audienceApp/teams/${teamId}.json`);
  if (!res.ok) throw new Error('team_fetch_failed');
  return res.json();
}

async function recordVote(env, teamId, voterToken) {
  const res = await fetch(`${env.FIREBASE_DB_URL}/audienceApp/votes.json`, {
    method: 'POST',
    body: JSON.stringify({ teamId, voterToken, votedAt: Date.now() })
  });
  if (!res.ok) throw new Error('vote_write_failed');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/vote' && request.method === 'POST') {
      try {
        const payload = await request.json();
        const teamId = String(payload.teamId || '').trim();
        const voterToken = String(payload.voterToken || '').trim();

        if (!teamId || !voterToken) {
          return Response.json({ error: 'invalid_request' }, { status: 400 });
        }

        if (!env.FIREBASE_DB_URL || !env.AUDIENCE_VOTES) {
          return Response.json({ error: 'server_misconfigured' }, { status: 500 });
        }

        /* 受付状態を最初に見る。締め切り後の書き込みを一切発生させないため */
        if (!(await isVotingOpen(env))) {
          return Response.json({ error: 'voting_closed' }, { status: 403 });
        }

        const team = await getTeam(env, teamId);
        if (team === null) {
          return Response.json({ error: 'invalid_team' }, { status: 400 });
        }
        if (!isVisibleTeam(team)) {
          return Response.json({ error: 'team_not_participating' }, { status: 403 });
        }

        await recordVote(env, teamId, voterToken);

        /* 追記に成功した送信だけを数える */
        const attemptCount = await readAttemptCount(env, voterToken);
        await writeAttemptCount(env, voterToken, attemptCount + 1);

        return Response.json({ ok: true, teamId, voterToken });
      } catch (error) {
        if (
          error.message === 'settings_fetch_failed' ||
          error.message === 'team_fetch_failed' ||
          error.message === 'vote_write_failed'
        ) {
          return Response.json({ error: error.message }, { status: 500 });
        }
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
