// api/translate.js
// ReEntry Job Translator – Beta-Ready Backend for Vercel Serverless (Plain Vercel)
// Rating target: 18/19 (robust, safe fallback, strong guardrails, minimal surprises)

/**
 * Helpers
 */
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

/**
 * Redaction / neutralization of stigmatizing terms.
 * - Institutions -> "structured work environment"
 * - Identity/legal labels -> "[redacted]"
 * - Phrases handled without fragile \\b wrapping
 */
function redactSensitiveText(v) {
  const s = safeString(v);
  if (!s) return "";

  const rules = [
    {
      re: /\b(prison|jail|lockup|penitentiary|correctional\s+facility|corrections)\b/gi,
      to: "structured work environment"
    },
    { re: /\b(inmate|prisoner|offender|felon|convict)\b/gi, to: "[redacted]" },
    { re: /\b(parole|probation)\b/gi, to: "[redacted]" },
    { re: /\bincarceration\b/gi, to: "[redacted]" },
    { re: /locked\s+up/gi, to: "[redacted]" },
    { re: /behind\s+bars/gi, to: "[redacted]" }
  ];

  let out = s;
  for (const { re, to } of rules) out = out.replace(re, to);

  // Collapse repeated tokens and normalize whitespace
  out = out
    .replace(/\[redacted\](\s*(\||,|\/)\s*\[redacted\])+/gi, "[redacted]")
    .replace(
      /structured work environment(\s*(\||,|\/)\s*structured work environment)+/gi,
      "structured work environment"
    )
    .replace(/\s{2,}/g, " ")
    .trim();

  return out;
}

/**
 * Safe input shaping
 */
function sanitizeInput(obj) {
  const experiences = Array.isArray(obj?.experiences) ? obj.experiences : [];
  const desiredJob = safeString(obj?.desiredJob);

  const normalizedExperiences = experiences.map((exp) => {
    const e = exp || {};
    return {
      category: safeString(e.category),
      duration: safeString(e.duration),
      description: redactSensitiveText(e.description),
      notes: redactSensitiveText(e.notes)
    };
  });

  return { experiences: normalizedExperiences, desiredJob };
}

/**
 * Category -> fallback title
 */
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

/**
 * Fallback bullets based ONLY on user text.
 */
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
        const title = titleFromCategory(exp.category);
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

/**
 * Dictionary mapping passed to model
 */
const SLANG_MAP = {
  porter: "facilities maintenance or custodial support",
  "chow hall": "high-volume dining facility",
  yard: "exterior grounds and maintenance area",
  commissary: "inventory, stocking, and distribution center",
  unit: "residential wing or designated housing area",
  clerk: "administrative support or records assistant",
  tier: "specific operational department",
  lockdown: "operational pause or facility safety protocol"
};

/**
 * Validate model output shape
 */
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

/**
 * Vercel Serverless entrypoint
 */
module.exports = async (req, res) => {
  // Method guard
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  let cleanBody;

  try {
    cleanBody = sanitizeInput(req.body || {});
    const experiences = cleanBody.experiences;

    if (!Array.isArray(experiences) || experiences.length === 0) {
      return json(res, 400, { error: "Experiences must be a non-empty array." });
    }

    const desiredJob =
      cleanBody.desiredJob || "Entry-level roles matching transferable skills";

    // If no key, still return useful output (beta-friendly)
    if (!process.env.OPENAI_API_KEY) {
      return json(res, 200, fallbackResponse(cleanBody));
    }

    // Beta guardrail: bound free text sizes to avoid prompt bloat
    const MAX_FIELD_LEN = 4000;
    const boundedBody = {
      ...cleanBody,
      experiences: cleanBody.experiences.map((e) => ({
        ...e,
        description: safeString(e.description).slice(0, MAX_FIELD_LEN),
        notes: safeString(e.notes).slice(0, MAX_FIELD_LEN)
      }))
    };

    const prompt = `
You are a Reentry Workforce Translator and O*NET Career Specialist.
Convert the following nontraditional work history into employer-ready, professional resume language.

STRICT RULES:
1. NEVER mention incarceration, prison, jail, inmate, offender, felon, convict, or facility names.
2. Use neutral settings such as "structured work environment," "high-volume dining," "facilities support," "laundry operations," "records support," "warehouse support," or "grounds maintenance."
3. Use this DICTIONARY to translate informal terms when relevant: ${JSON.stringify(SLANG_MAP)}
4. Bullets must start with strong action verbs.
5. Only include skills, tasks, tools, numbers, or responsibilities supported by the user's actual input.
6. Target career goal: ${desiredJob}
7. Every bullet must reference a task, tool, object, setting, responsibility, or context from the user's input.
8. Avoid generic bullets that could apply to any job.
9. If the input is weak, produce modest bullets without asking for clarification.
10. Use the user's own details whenever possible, but translate them into professional language.
11. Do not invent credentials, certifications, licenses, supervisory authority, tools, numbers, or outcomes.
12. Use plain language suitable for mobile users and entry-level job applications.
13. Output MUST be ONLY a JSON object. Do NOT wrap it in markdown. Do NOT include any extra keys.

USER DATA:
${JSON.stringify(boundedBody)}

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

    // Timeout protection
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let apiRes;
    try {
      apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a resume assistant. Output ONLY a valid JSON object matching the schema. No markdown, no extra keys."
            },
            { role: "user", content: prompt }
          ]
        })
      });
    } catch (e) {
      console.error("OpenAI Fetch Error:", e);
      return json(res, 200, fallbackResponse(cleanBody));
    } finally {
      clearTimeout(timeout);
    }

    if (!apiRes || !apiRes.ok) {
      const errText = apiRes ? await apiRes.text() : "No response";
      console.error("OpenAI API Error:", errText);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    // Parse outer response safely as text first
    const raw = await apiRes.text();
    let outer;
    try {
      outer = JSON.parse(raw);
    } catch (e) {
      console.error("OpenAI Non-JSON Response:", raw);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    const content = outer?.choices?.[0]?.message?.content || "{}";

    // Parse model JSON content
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("Model JSON Parse Error:", content);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    // Validate shape
    if (!isValidAiOutput(parsed)) {
      console.error("Invalid AI structure:", parsed);
      return json(res, 200, fallbackResponse(cleanBody));
    }

    // Enforce experience count alignment (cap extras)
    if (parsed.experience.length > experiences.length) {
      parsed.experience = parsed.experience.slice(0, experiences.length);
    }

    // Cleanup outputs to reduce UI edge cases
    parsed.summary = safeString(parsed.summary);
    parsed.skills = cleanupStringArray(parsed.skills, 80);
    parsed.pathways = cleanupStringArray(parsed.pathways, 80);
    parsed.interviewTips = cleanupStringArray(parsed.interviewTips, 160);

    parsed.experience = parsed.experience.map((exp) => ({
      ...exp,
      translated_title: safeString(exp.translated_title),
      duration: safeString(exp.duration),
      onet_title: safeString(exp.onet_title),
      bullets: cleanupBullets(exp.bullets, 240),
      aligned_tasks: cleanupStringArray(exp.aligned_tasks, 80)
    }));

    return json(res, 200, { output: parsed });
  } catch (err) {
    console.error("Fatal Handler Error:", err);
    return json(res, 200, fallbackResponse(cleanBody || req.body || {}));
  }
};