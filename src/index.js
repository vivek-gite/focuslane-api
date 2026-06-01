const AI_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handleCORS(request);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/classify") {
      return handleClassify(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  }
};

async function handleClassify(request, env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonResponse({ results: {}, error: "service_misconfigured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { titles, filterRule } = body;

  if (!titles || !Array.isArray(titles) || titles.length === 0) {
    return jsonResponse({ error: "titles array is required" }, 400);
  }

  if (!filterRule || typeof filterRule !== "string" || filterRule.trim().length === 0) {
    return jsonResponse({ error: "filterRule string is required" }, 400);
  }

  if (titles.length > 50) {
    return jsonResponse({ error: "Maximum 50 titles per request" }, 400);
  }

  for (const item of titles) {
    if (!item || typeof item.id !== "string" || typeof item.title !== "string") {
      return jsonResponse({ error: "Each title must have id and title strings" }, 400);
    }
  }

  const sanitizedRule = filterRule.trim().slice(0, 500);
  const sanitizedTitles = titles.map((t) => ({
    id: t.id.slice(0, 20),
    title: t.title.slice(0, 200)
  }));

  const titlesStr = sanitizedTitles.map((t, i) => `${i}:${t.title}`).join("\n");

  const prompt = `TASK: Filter a YouTube feed based on the user's rule.
USER RULE: "${sanitizedRule}"

INSTRUCTIONS:
- Apply the user's rule to decide which videos to SHOW.
- If the rule says "only show X", show videos matching X and hide everything else.
- If the rule says "hide X" or "remove X", hide videos matching X and show everything else.
- Be strict. When unsure, lean toward hiding.

VIDEOS:
${titlesStr}

OUTPUT: Only comma-separated indices of videos to SHOW. If none should be shown, say NONE.`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 60
      })
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        return jsonResponse({ results: {}, error: "auth_error" }, 502);
      }
      if (status === 429) {
        return jsonResponse({ results: {}, error: "rate_limited" }, 429);
      }
      return jsonResponse({ results: {}, error: `upstream_${status}` }, 502);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const results = {};

    if (!content || content.toUpperCase() === "NONE") {
      for (const t of sanitizedTitles) results[t.id] = false;
      return jsonResponse({ results, error: null });
    }

    const relevantIndices = new Set(
      content
        .replace(/[^0-9,]/g, "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n < sanitizedTitles.length)
    );

    for (let i = 0; i < sanitizedTitles.length; i++) {
      results[sanitizedTitles[i].id] = relevantIndices.has(i);
    }

    return jsonResponse({ results, error: null });
  } catch (err) {
    return jsonResponse({ results: {}, error: "api_error" }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function handleCORS(request) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}
