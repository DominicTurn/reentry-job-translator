// api/translate.js
// ReEntry Job Translator – Anthropic Claude Sonnet Backend for Vercel Serverless

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safeString(v) {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function cleanupStringArray(arr, maxLen = 80) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => safeString(x))
    .filter(Boolean)
    .map((x) => (x.length > maxLen ? x.slice(0, maxLen - 3).trimEnd() + "..." : x));
}

function cleanupBullets(bullets, maxLen = 240) {
  return (Array.isArray(bullets) ? bullets : [])
    .map((b) => safeString(b))
    .filter(Boolean)
    .map((b) => (b.length > maxLen ? b.slice(0, maxLen - 3).trimEnd() + "..." : b));
}

function redactSensitiveText(v) {
  const s = safeString(v);
  if (!s) return "";

  const rules = [
    { re: /\b(prison|jail|lockup|penitentiary|correctional\s+facility|corrections)\b/gi, to: "structured work environment" },
    { re: /\b(inmate|prisoner|offender|felon|convict)\b/gi, to: "[redacted]" },
    { re: /\b(parole|probation)\b/gi, to: "[redacted]" },
    { re: /\bincarceration\b/gi, to: "[redacted]" },
    { re: /locked\s+up/gi, to: "[redacted]" },
    { re: /behind\s+bars/gi, to: "[redacted]" }
  ];

  let out = s;
  for (const { re, to } of rules) out = out.replace(re, to);

  return out
    .replace(/\[redacted\](\s*(\||,|\/)\s*\[redacted\])+/gi, "[redacted]")
    .replace(/structured work environment(\s*(\||,|\/)\s*structured work environment)+/gi, "structured work environment")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeInput(obj) {
  const experiences = Array.isArray(obj?.experiences) ? obj.experiences : [];

  const desiredJob = safeString(
    obj?.desiredJob || obj?.supportNote || obj?.targetRole
  );

  const normalizedExperiences = experiences.map((exp) => {
    const e = exp || {};

    return {
      category: safeString(e.category),
      title: redactSensitiveText(e.title),
      organization: redactSensitiveText(e.organization),
      duration: safeString(e.duration),
      description: redactSensitiveText(e.description || e.details || ""),
      notes: redactSensitiveText(e.notes || "")
    };
  });

  return {
    experiences: normalizedExperiences,
    desiredJob
  };
}

function titleFromCategory(category = "") {
  const key = safeString(category).toLowerCase();

  const map = {
    kitchen: "Food Service Support Worker",
    "facility-operations": "Facilities Support Worker",
    laundry: "Laundry and Linen Services Worker",
    clerical: "Administrative Support Assistant",
    canteen: "Customer Associate",
    houseman: "Custodian",
    grounds: "Grounds Maintenance Worker",
    orderly: "Environmental Services Assistant",
    peer: "Peer Support Assistant"
  };

  return map[key] || "Operations Support Worker";
}

function bulletsFromExperience(exp, title) {
  const desc = safeString(exp?.description);
  const notes = safeString(exp?.notes);
  const combined = [desc, notes].filter(Boolean).join(" | ");

  if (combined) {
    return [
      `Completed ${title.toLowerCase()} tasks described as: ${combined}.`,
      `Followed daily expectations and basic safety practices while handling: ${combined}.`,
      `Maintained consistent task completion in a structured work environment while performing: ${combined}.`
    ].map((b) => b.replace(/\s{2,}/g, " ").trim());
  }

  return [
    `Completed core ${title.toLowerCase()} tasks in a structured work environment.`,
    "Completed assigned tasks while following daily expectations and basic safety practices.",
    "Maintained consistent performance while supporting daily operations and workflow."
  ];
}

function fallbackResponse(cleanBody) {
  const experiences = Array.isArray(cleanBody?.experiences) ? cleanBody.experiences : [];

  return {
    output: {
      summary:
        "Reliable candidate with hands-on experience completing assigned tasks and supporting daily operations in structured work environments.",
      experience: experiences.map((exp) => {
        const title = safeString(exp.title) || titleFromCategory(exp.category);

        return {
          translated_title: title,
          duration: safeString(exp.duration) || "Not specified",
          onet_title: title,
          bullets: bulletsFromExperience(exp, title),
          aligned_tasks: [
            "Follow workplace expectations",
            "Complete assigned operational tasks",
            "Support daily workflow"
          ]
        };
      }),
      skills: [
        "Reliability",
        "Task Completion",
        "Following Instructions",
        "Time Management",
        "Safety Awareness",
        "Team Support"
      ],
      pathways: [
        "General Laborer",
        "Warehouse Associate",
        "Facilities Assistant",
        "Food Service Worker",
        "Custodian"
      ],
      interviewTips: [
        "Describe the specific tasks you completed and the setting where you performed them.",
        "Share how you stayed consistent with daily expectations and basic safety practices.",
        "Connect your past responsibilities to the role you are applying for now."
      ]
    }
  };
}

function isValidAiOutput(parsed) {
  if (!parsed || typeof parsed !== "object") return false;

  if (!safeString(parsed.summary)) return false;
  if (!Array.isArray(parsed.experience) || parsed.experience.length === 0) return false;
  if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) return false;
  if (!Array.isArray(parsed.pathways) || parsed.pathways.length === 0) return false;
  if (!Array.isArray(parsed.interviewTips) || parsed.interviewTips.length === 0) return false;

  for (const exp of parsed.experience) {
    if (!exp || typeof exp !== "object") return false;
    if (!safeString(exp.translated_title)) return false;
    if (!safeString(exp.duration)) return false;
    if (!safeString(exp.onet_title)) return false;
    if (!Array.isArray(exp.bullets) || exp.bullets.length === 0) return false;
    if (!Array.isArray(exp.aligned_tasks)) return false;
  }

  return true;
}

function extractJson(content) {
  const text = safeString(content);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in model response.");
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let cleanBody;

  try {
    cleanBody = sanitizeInput(req.body || {});

    if (!Array.isArray(cleanBody.experiences) || cleanBody.experiences.length === 0) {
      return json(res, 400, { error: "Experiences must be a non-empty array." });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return json(res, 200, fallbackResponse(cleanBody));
    }

    const MAX_FIELD_LEN = 4000;

    const boundedBody = {
      ...cleanBody,
      experiences: cleanBody.experiences.map((e) => ({
        ...e,
        description: safeString(e.description).slice(0, MAX_FIELD_LEN),
        notes: safeString(e.notes).slice(0, MAX_FIELD_LEN)
      }))
    };

    const boundedExperienceCount = boundedBody.experiences.length;

    const prompt = `
You are a Reentry Workforce Translator and O*NET Career Specialist.
Convert the following nontraditional work history into employer-ready, professional resume language.

STRICT RULES:
- Use the user's original role title as context when generating translated titles and bullets.
- Do not mention incarceration, prison, jail, inmate, offender, felon, convict, justice-impacted, formerly incarcerated, correctional facility, or similar background-identifying terms.
- Do not invent credentials, certifications, licenses, job authority, leadership, numbers, tools, or outcomes the user did not provide.
- Translate the setting, not the stigma. Use neutral terms like structured work environment, high-volume kitchen, facilities support, laundry operations, records support, warehouse support, grounds maintenance, customer service, or team-based operations.
- Keep every resume bullet honest, short, clear, and copy-ready.
- Each bullet must begin with a strong action verb.
- Use ATS-friendly keywords naturally, but do not keyword stuff.
- Use common employer search terms only when truthful, such as inventory support, sanitation, food safety, material handling, stocking, documentation, data entry, customer service, equipment use, safety procedures, quality control, cleaning procedures, scheduling, teamwork, training support, and workflow coordination.
- Prioritize realistic entry-level, no-license roles with clear advancement paths.
- Do not use inflated titles such as manager, supervisor, specialist, technician, counselor, case manager, or coordinator unless the user clearly described that level of responsibility.
- Use employer-safe translated titles such as Food Service Worker, Facilities Support Worker, Warehouse Associate, Laundry Attendant, Grounds Maintenance Worker, Office Support Assistant, Customer Service Assistant, Program Support Assistant, or Peer Support Assistant.
- Do not use filler words like hardworking, passionate, motivated, or dedicated unless backed by a concrete action.
- Avoid corporate buzzwords.
- If desired job is blank, generate best-fit pathways from experience.
- If desired job is provided, connect prior experience to that target.
- Keep outputs concise and practical.
- Do not repeat ideas across bullets.
- Bullets should usually stay under 25 words.
- The tone should be respectful, practical, and confidence-building.
- Write for a person who may need plain language and may be applying from a phone.
- Return valid JSON only. No markdown, commentary, explanations, or code fences.

Output rules:
- The summary should be 2–3 sentences.
- The summary should include 3–6 relevant ATS-friendly keywords naturally.
- Each experience should include 3–5 resume bullets.
- Bullets should be one sentence each.
- Aligned tasks should sound like O*NET-style work activities but stay readable.
- Skills should include 8–14 transferable skills.
- Pathways should include 3–5 realistic job titles.
- Interview tips should include 3 short talking points that help the user explain the experience professionally without mentioning background details.

USER DATA:
${JSON.stringify(boundedBody, null, 2)}

RETURN ONLY VALID JSON matching this exact structure:
{
  "summary": "",
  "experience": [
    {
      "translated_title": "",
      "duration": "",
      "onet_title": "",
      "bullets": [],
      "aligned_tasks": []
    }
  ],
  "skills": [],
  "pathways": [],
  "interviewTips": []
}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let apiRes;

    try {
      apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
          max_tokens: 4000,
          temperature: 0.1,
          system:
            "You are a resume assistant. Output ONLY a valid JSON object matching the requested schema. No markdown, no commentary, no extra keys.",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });
    } catch (e) {
      console.error("Anthropic Fetch Error:", e);
      return json(res, 200, fallbackResponse(cleanBody));
    } finally {
      clearTimeout(timeout);
    }

    if (!apiRes || !apiRes.ok) {
      const errText = apiRes ? await apiRes.text() : "No response";
      console.error("Anthropic API Error:", errText);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    const raw = await apiRes.text();

    let outer;
    try {
      outer = JSON.parse(raw);
    } catch (e) {
      console.error("Anthropic Non-JSON Response:", raw);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    const content = outer?.content?.[0]?.text || "{}";

    let parsed;
    try {
      parsed = extractJson(content);
    } catch (e) {
      console.error("Model JSON Parse Error:", content);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    if (!isValidAiOutput(parsed)) {
      console.error("Invalid AI structure:", parsed);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    if (parsed.experience.length > boundedExperienceCount) {
      parsed.experience = parsed.experience.slice(0, boundedExperienceCount);
    }

    parsed.summary = safeString(parsed.summary);
    parsed.skills = cleanupStringArray(parsed.skills, 80);
    parsed.pathways = cleanupStringArray(parsed.pathways, 80);
    parsed.interviewTips = cleanupStringArray(parsed.interviewTips, 200);

    parsed.experience = parsed.experience.map((exp) => ({
      ...exp,
      translated_title: safeString(exp.translated_title),
      duration: safeString(exp.duration),
      onet_title: safeString(exp.onet_title),
      bullets: cleanupBullets(exp.bullets, 240),
      aligned_tasks: cleanupStringArray(exp.aligned_tasks, 80)
    }));

    return json(res, 200, { output: parsed });
  } catch (e) {
    console.error("Translate Handler Error:", e);
    return json(res, 200, fallbackResponse(cleanBody || { experiences: [] }));
  }
};
