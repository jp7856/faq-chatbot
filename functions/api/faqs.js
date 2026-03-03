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

  const subjects = [...html.matchAll(/<td[^>]*class=["']subject["'][^>]*>([\s\S]*?)<\/td>/gi)]
    .map(m => stripTags(m[1]))
    .filter(Boolean);

  for (let i = 0; i + 1 < subjects.length; i += 2) {
    faqs.push({
      id: `faq-${i / 2 + 1}`,
      q: subjects[i],
      a: subjects[i + 1],
    });
  }

  return faqs;
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

    if (!r.ok) throw new Error(`fetch failed: ${r.status}`);

    // 🔥 EUC-KR 강제 디코딩
    const buffer = await r.arrayBuffer();
    const html = new TextDecoder("euc-kr").decode(buffer);

    const faqs = parseFaqRows(html);

    return new Response(JSON.stringify({ ok: true, count: faqs.length, faqs }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
};