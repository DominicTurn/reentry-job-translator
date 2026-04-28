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
You are a reentry workforce translator.

Convert user work history into employer-ready resume language.

Rules:
- Do not exaggerate or invent credentials.
- Use neutral professional language.
- Keep bullets short and copy-ready.
- No mention of incarceration.
- Suggest realistic entry-level pathways.
- Return valid JSON only.

Use this exact format:

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