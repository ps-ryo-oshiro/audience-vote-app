/* 表示判定。3か所で揃える判定規則。app.js・admin.js・worker.js で同じ内容にすること */
function isVisibleTeam(team) {
  return !!team && (team.finalist === true || team.participating === true);
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

        const voteKey = `voter:${voterToken}`;

        const existing = await env.AUDIENCE_VOTES.get(voteKey);
        if (existing === '1') {
          return Response.json({ error: 'already_voted' }, { status: 409 });
        }

        const team = await getTeam(env, teamId);
        if (team === null) {
          return Response.json({ error: 'invalid_team' }, { status: 400 });
        }
        if (!isVisibleTeam(team)) {
          return Response.json({ error: 'team_not_participating' }, { status: 403 });
        }

        await recordVote(env, teamId, voterToken);

        await env.AUDIENCE_VOTES.put(voteKey, '1', { expirationTtl: 60 * 60 * 24 * 30 });

        return Response.json({ ok: true, teamId, voterToken });
      } catch (error) {
        if (error.message === 'team_fetch_failed' || error.message === 'vote_write_failed') {
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
