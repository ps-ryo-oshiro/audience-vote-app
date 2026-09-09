const VOTE_STORE = globalThis.__AUDIENCE_VOTES__ || (globalThis.__AUDIENCE_VOTES__ = new Map());

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

        const voteKey = `voter:${voterToken}`;

        if (env.AUDIENCE_VOTES) {
          const existing = await env.AUDIENCE_VOTES.get(voteKey);
          if (existing === '1') {
            return Response.json({ error: 'already_voted' }, { status: 409 });
          }
          await env.AUDIENCE_VOTES.put(voteKey, '1', { expirationTtl: 60 * 60 * 24 * 30 });
        } else {
          if (VOTE_STORE.has(voteKey)) {
            return Response.json({ error: 'already_voted' }, { status: 409 });
          }
          VOTE_STORE.set(voteKey, '1');
        }

        return Response.json({ ok: true, teamId, voterToken });
      } catch (error) {
        return Response.json({ error: 'invalid_json' }, { status: 400 });
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
