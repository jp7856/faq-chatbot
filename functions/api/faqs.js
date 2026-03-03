const LIST_URL = "https://www.netimes.co.kr/pages/customer/jq_faqlist.asp";

function htmlDecode(s) {
  return (s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripTags(s) {
  return htmlDecode(
    (s || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|td|th|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

function parseFaqRows(html) {
  const faqs = [];

  const qRe = /<tr[^>]*class=["']bg["'][\s\S]*?<\/tr>/gi;
  const aRe = /<tr[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][\s\S]*?<\/tr>/gi;

  const qRows = html.match(qRe) || [];
  const aRows = html.match(aRe) || [];

  const n = Math.min(qRows.length, aRows.length);

  for (let i = 0; i < n; i++) {
    const qRow = qRows[i];
    const aRow = aRows[i];

    const qTd = /<td[^>]*class=["']subject["'][^>]*>([\s\S]*?)<\/td>/i.exec(qRow);
    const aTd = /<td[^>]*class=["']subject["'][^>]*>([\s\S]*?)<\/td>/i.exec(aRow);

    const q = stripTags(qTd?.[1] || "");
    const a = stripTags(aTd?.[1] || "");

    if (!q || !a) continue;

    faqs.push({ id: `faq-${i + 1}`, q, a });
  }

  // fallback: subject td들을 2개씩 (Q/A) 묶기
  if (faqs.length === 0) {
    const subjects = [...html.matchAll(/<td[^>]*class=["']subject["'][^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => stripTags(m[1]))
      .filter(Boolean);

    for (let i = 0; i + 1 < subjects.length; i += 2) {
      faqs.push({ id: `faq-${i / 2 + 1}`, q: subjects[i], a: subjects[i + 1] });
    }
  }

  const seen = new Set();
  return faqs.filter(f => {
    if (seen.has(f.q)) return false;
    seen.add(f.q);
    return true;
  });
}

export const onRequestGet = async () => {
  try {
    const r = await fetch(LIST_URL, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "text/html,*/*",
        "referer": "https://www.netimes.co.kr/pages/customer/faq.asp",
      },
    });

    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, error: `fetch failed: ${r.status}` }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const html = await r.text();
    const faqs = parseFaqRows(html);

    return new Response(JSON.stringify({ ok: true, count: faqs.length, faqs }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=600",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};