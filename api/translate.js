// api/translate.js
// OpenAI Production-Grade Backend for ReEntry Job Translator

/** 
 * HELPER FUNCTIONS 
 */
function json(res, code, payload) {
  return res.status(code).json(payload);
}

function safeString(v) {
  return String(v || "").trim();
}

/** 
 * FALLBACK LOGIC
 * Used if the API is down, keys are missing, or the model fails to return JSON.
 */
function titleFromCategory(category = "") {
  const map = {
    kitchen: "Food Service Support Worker",
    "facility-operations": "Facilities Support Worker",
    laundry: "Laundry and Linen Services Worker",
    clerical: "Administrative Support Assistant",
    canteen: "Customer Associate",
    houseman: "Custodian",
    grounds: "Grounds Maintenance Worker",
    orderly: "Assistant",
    peer: "Peer Support Assistant"
  };
  return map[category] || "Operations Support Worker";
}

function fallbackResponse(body) {
  const experiences = body.experiences || [];
  return {
    output: {
      summary: "Reliable candidate with hands-on experience completing daily assignments and supporting team operations in structured work environments.",
      experience: experiences.map((exp) => ({
        translated_title: titleFromCategory(exp.category),
        duration: safeString(exp.duration),
        onet_title: titleFromCategory(exp.category),
        bullets: [
          "Maintained consistent performance in a high-volume, structured environment.",
          "Collaborated with team members to complete daily operational tasks safely.",
          "Followed strict schedules and procedures to ensure workflow efficiency."
        ],
        aligned_tasks: ["Follow procedures", "Complete assigned work", "Support team operations"]
      })),
      skills: ["Reliability", "Teamwork", "Following Procedures", "Time Management"],
      pathways: ["General Laborer", "Warehouse Associate", "Facilities Assistant"],
      interviewTips: [
        "Focus on your punctuality and reliability.",
        "Discuss your experience working in fast-paced environments.",
        "Emphasize your ability to follow safety and operational protocols."
      ]
    }
  };
}

/** 
 * DICTIONARY MAPPING
 * Helps the AI map institutional terms to professional equivalents.
 */
const SLANG_MAP = {
  "porter": "facilities maintenance or custodial support",
  "chow hall": "high-volume dining facility",
  "yard": "exterior grounds and maintenance area",
  "commissary": "inventory, stocking, and distribution center",
  "unit": "residential wing or designated housing area",
  "clerk": "administrative support or records assistant",
  "tier": "specific operational department",
  "lockdown": "operational pause or facility safety protocol"
};

/** 
 * MAIN HANDLER 
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const experiences = body.experiences || [];
    const desiredJob = body.desiredJob || "Entry-level roles matching transferable skills";

    if (!experiences.length) {
      return json(res, 400, { error: "No experience provided." });
    }

    // Check for API Key
    if (!process.env.OPENAI_API_KEY) {
      return json(res, 200, fallbackResponse(body));
    }

    const prompt = `
    You are a Reentry Workforce Translator and O*NET Career Specialist. 
    Convert the following nontraditional work history into employer-ready, professional resume language.

    STRICT RULES:
    1. NEVER mention: incarceration, prison, jail, inmate, offender, felon, convict, or facility names.
    2. Use neutral settings: "structured work environment," "high-volume dining," "facilities support."
    3. Use the following DICTIONARY to translate terms: ${JSON.stringify(SLANG_MAP)}
    4. Bullets must start with strong ACTION VERBS.
    5. Prioritize ATS-friendly keywords (sanitation, inventory, safety, teamwork).
    6. Target Goal: Align this resume for a career in: ${desiredJob}

    USER DATA:
    ${JSON.stringify(body)}

    RETURN ONLY A VALID JSON OBJECT matching this structure:
    {
      "summary": "2-3 sentences with keywords.",
      "experience": [
        {
          "translated_title": "Professional Title",
          "duration": "User-provided duration",
          "onet_title": "Closest O*NET match",
          "bullets": ["3-5 clear bullets"],
          "aligned_tasks": ["3-5 O*NET style tasks"]
        }
      ],
      "skills": ["8-14 transferable skills"],
      "pathways": ["3-5 realistic job titles"],
      "interviewTips": ["3 talking points for explaining the gap/experience professionaly"]
    }
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.1, // Low temperature for factual consistency
        response_format: { type: "json_object" }, // OpenAI JSON Mode
        messages: [
          { 
            role: "system", 
            content: "You are a resume assistant that strictly outputs valid JSON for reentry workforce development." 
          },
          { role: "user", content: prompt }
        ]
      })
    });

    clearTimeout(timeout);

    if (!apiRes.ok) {
      console.error("OpenAI API Error:", await apiRes.text());
      return json(res, 200, fallbackResponse(body));
    }

    const data = await apiRes.json();
    const text = data?.choices?.[0]?.message?.content || "{}";
    
    // Parse the JSON string from OpenAI
    const parsed = JSON.parse(text);

    return json(res, 200, {
      output: parsed
    });

  } catch (err) {
    console.error("Fatal Handler Error:", err);
    return json(res, 200, fallbackResponse(req.body || {}));
  }
}
