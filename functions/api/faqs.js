const FAQ_URL = "https://www.netimes.co.kr/pages/customer/faq.asp";

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const onRequestGet = async () => {
  try {
    const res = await fetch(FAQ_URL, {
      headers: {
        "user-agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "FAQ fetch failed" }),
        { status: 500 }
      );
    }

    const html = await res.text();
    const text = stripHtml(html);

    // FAQ 번호 기준으로 분리
    const regex = /FAQ\s*(\d+)([\s\S]*?)(?=FAQ\s*\d+|$)/g;
    const faqs = [];

    let match;
    while ((match = regex.exec(text)) !== null) {
      const body = match[2].trim();
      const lines = body.split(".").map(l => l.trim()).filter(Boolean);

      if (lines.length < 2) continue;

      const q = lines[0];
      const a = lines.slice(1).join(". ");

      if (q.length > 5 && a.length > 10) {
        faqs.push({
          id: `faq-${match[1]}`,
          q,
          a,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, count: faqs.length, faqs }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500 }
    );
  }
};