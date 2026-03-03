const FAQ_URL = "https://www.netimes.co.kr/pages/customer/faq.asp";

function cleanText(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const onRequestGet = async () => {
  try {
    const response = await fetch(FAQ_URL, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept": "text/html"
      }
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: "Fetch failed" }),
        { status: 500 }
      );
    }

    const html = await response.text();

    // 🔎 디버그: 원본 길이 & FAQ 문자열 존재 여부 확인
    const hasFAQWord = /FAQ/i.test(html);
    const cleaned = cleanText(html);

    // FAQ 번호 기준 분리 (FAQ 1, FAQ1 모두 허용)
    const regex = /FAQ\s*(\d+)([\s\S]*?)(?=FAQ\s*\d+|$)/gi;

    const faqs = [];
    let match;

    while ((match = regex.exec(cleaned)) !== null) {
      const number = match[1];
      const block = match[2].trim();

      if (!block) continue;

      // 첫 문장을 질문으로 가정
      const parts = block.split(".").map(p => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;

      const q = parts[0];
      const a = parts.slice(1).join(". ");

      if (q.length > 5 && a.length > 10) {
        faqs.push({
          id: `faq-${number}`,
          q,
          a
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        htmlLength: html.length,
        hasFAQWord,
        count: faqs.length,
        faqs
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: String(error) }),
      { status: 500 }
    );
  }
};