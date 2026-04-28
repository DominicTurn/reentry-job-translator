// api/translate.js
// OpenAI production-grade backend for ReEntry Job Translator

function json(res, code, payload) {
  return res.status(code).json(payload);
}

function safeString(v) {
  return String(v || "").trim();
}

function roleLabel(category = "") {
  const map = {
    kitchen: "food service",
    "facility-operations": "facilities support",
    laundry: "laundry and linen services",
    clerical: "administrative support",
    warehouse: "warehouse and logistics",
    grounds: "grounds and maintenance",
    peer: "peer support and mentoring"
  };
  return map[category] || "operations support";
}

function titleFromCategory(category = "") {
  const map = {
    kitchen: "Food Service Support Worker",
    "facility-operations": "Facilities Support Worker",
    laundry: "Laundry and Linen Services Worker",
    clerical: "Administrative Support Assistant",
    warehouse: "Warehouse Associate",
    grounds: "Grounds Maintenance Worker",
    peer: "Peer Support Assistant"
  };
  return map[category] || "Operations Support Worker";
}

function skillsFromCategory(category = "") {
  const base = [
    "Reliability",
    "Teamwork",
    "Following Procedures",
    "Time Management"
  ];

  const map = {
    kitchen: ["Food Safety", "Sanitation", "Meal Preparation"],
    "facility-operations": [
      "Cleaning Procedures",
      "Safety Awareness",
      "Detail Orientation"
    ],
    laundry: ["Sorting", "Workflow", "Quality Control"],
    clerical: ["Recordkeeping", "Documentation", "Organization"],
    warehouse: ["Inventory", "Stocking", "Material Handling"],
    grounds: ["Equipment Use", "Cleanup", "Safety Procedures"],
    peer: ["Communication", "Mentoring", "Conflict Resolution"]
  };

  return [...new Set([...(map[category] || []), ...base])];
}

function pathwaysFromCategory(category = "") {
  const map = {
    kitchen: [
      "Food Service Worker",
      "Prep Cook",
      "Kitchen Helper",
      "Cafeteria Worker"
    ],
    "facility-operations": [
      "Custodian",
      "Porter",
      "Facilities Assistant"
    ],
    laundry: [
      "Laundry Attendant",
      "Housekeeping Aide"
    ],
    clerical: [
      "Office Assistant",
      "Records Clerk"
    ],
    warehouse: [
      "Warehouse Associate",
      "Stock Clerk",
      "Material Handler"
    ],
    grounds: [
      "Groundskeeper",
      "Maintenance Helper"
    ],
    peer: [
      "Program Assistant",
      "Community Outreach Worker"
    ]
  };

  return map[category] || [
    "General Laborer",
    "Warehouse Associate"
  ];
}

function fallbackResponse(body) {
  const experiences = body.experiences || [];

  const output = {
    summary:
      "Reliable candidate with hands-on experience completing daily assignments, following procedures, and supporting team operations in structured work environments.",
    experience: experiences.map((exp) => ({
      translated_title: titleFromCategory(exp.category),
      duration: safeString(exp.duration),
      onet_title: titleFromCategory(exp.category),
      bullets: [
        `Completed daily ${roleLabel(exp.category)} duties while following procedures and schedules.`,
        "Worked with team members to complete tasks safely and on time.",
        "Maintained reliable attendance and consistent performance."
      ],
      aligned_tasks: [
        "Follow procedures",
        "Complete assigned work",
        "Support team operations"
      ]
    })),
    skills: [
      ...new Set(experiences.flatMap((exp) => skillsFromCategory(exp.category)))
    ],
    pathways: [
      ...new Set(experiences.flatMap((exp) => pathwaysFromCategory(exp.category)))
    ].slice(0, 5),
    interviewTips: [
      "Describe how you stayed reliable and consistent.",
      "Explain the tasks you handled daily.",
      "Mention teamwork, safety, and following procedures."
    ]
  };

  return { output };
}

function extractJson(text) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("No JSON object found.");
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const experiences = body.experiences || [];

    if (!experiences.length) {
      return json(res, 400, { error: "No experience provided." });
    }

    if (!process.env.OPENAI_API_KEY) {
      return json(res, 200, fallbackResponse(body));
    }
const prompt = `
You are a reentry workforce translator, ATS resume assistant, and O*NET-aligned career helper.

Your job is to convert nontraditional work history into employer-ready resume language. The output should help the user explain real work experience in professional terms without exaggeration, stigma, or unsafe claims.

Core goals:
- Translate the user's actual duties into clear resume language.
- Use truthful ATS-friendly keywords that match the user's real experience.
- Align work experience with relevant O*NET-style occupational categories, work activities, and transferable skills.
- Recommend realistic entry-level job pathways the user could apply for now.

Strict rules:
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

Use this exact JSON structure:

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

User data:
${JSON.stringify(body)}
`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You produce only valid JSON for structured resume outputs."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    clearTimeout(timeout);

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return json(res, 200, fallbackResponse(body));
    }

    const text =
      data?.choices?.[0]?.message?.content ||
      "{}";

    const parsed = extractJson(text);

    return json(res, 200, {
      output: parsed
    });
  } catch (err) {
    return json(res, 200, fallbackResponse(req.body || {}));
  }
}
