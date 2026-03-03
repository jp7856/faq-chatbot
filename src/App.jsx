import { useEffect, useMemo, useState } from "react";

/**
 * 로컬에서 반드시 FAQ 우선으로 동작:
 * - public/faq-fallback.json 을 읽어옴
 * - 질문을 유사매칭해서 가장 가까운 FAQ 답변을 반환
 * - 로컬에서는 "항상 FAQ" (점수 낮아도 fallback 안내 대신 FAQ 후보 중 1개는 답)
 *
 * 디버깅:
 * - 화면에 localFaq count / 마지막 점수 표시
 */

// ---------- 텍스트 전처리 ----------
function normalizeKo(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "은", "는", "이", "가", "을", "를", "에", "에서", "으로", "로", "과", "와",
  "좀", "조금", "정도", "관련", "문의", "질문",
  "어떻게", "방법", "가능", "되나요", "되요", "돼요", "해주세요", "해줘", "할래요",
  "언제", "몇일", "며칠", "얼마나", "기간", "시간",
]);

const SYNONYMS = {
  환불: ["환급", "돌려받", "반품", "취소", "결제취소", "환불문의", "환불 문의", "환불신청", "환불 신청"],
  취소: ["환불", "결제취소", "주문취소", "캔슬"],
  배송: ["도착", "언제와", "언제 와", "배송기간", "출고", "택배", "오나요", "언제옴", "언제 옴"],
  비밀번호: ["패스워드", "pw", "비번", "암호", "비밀번호찾기", "비번찾기"],
  현금영수증: ["영수증", "증빙", "소득공제", "현금 영수증"],
  세금계산서: ["계산서", "세금 계산서", "지출증빙"],
};

function expandWithSynonyms(text) {
  let out = text;
  const t = normalizeKo(text);

  for (const [key, arr] of Object.entries(SYNONYMS)) {
    const hasKey = t.includes(normalizeKo(key));
    const hasSyn = arr.some((w) => t.includes(normalizeKo(w)));
    if (hasKey || hasSyn) out += ` ${key}`;
  }
  return out;
}

function tokens(text) {
  const n = normalizeKo(expandWithSynonyms(text));
  if (!n) return [];
  return n
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS.has(t));
}

// ---------- 점수 계산 ----------
function jaccard(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;

  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;

  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function partialBonus(a, b) {
  const aa = normalizeKo(a);
  const bb = normalizeKo(b);

  // 너무 짧은 문장 포함은 노이즈라 제한
  if (aa.length >= 4 && (bb.includes(aa) || aa.includes(bb))) return 0.25;
  return 0;
}

function keywordBoost(user, faqQ) {
  // 대표 키워드가 FAQ 질문에 들어있고, 사용자가 동의어라도 썼으면 가산점
  const u = normalizeKo(user);
  const f = normalizeKo(faqQ);
  let boost = 0;

  for (const [key, arr] of Object.entries(SYNONYMS)) {
    const keyInFaq = f.includes(normalizeKo(key));
    if (!keyInFaq) continue;

    const userHasKey = u.includes(normalizeKo(key));
    const userHasSyn = arr.some((w) => u.includes(normalizeKo(w)));
    if (userHasKey || userHasSyn) boost += 0.35; // 크게 올려서 유사질문 매칭 강화
  }

  return boost;
}

function score(userQ, faqQ) {
  return jaccard(userQ, faqQ) + partialBonus(userQ, faqQ) + keywordBoost(userQ, faqQ);
}

function rankFaq(message, faqs, topK = 3) {
  return faqs
    .map((f) => ({ item: f, score: score(message, f.q) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ---------- UI ----------
export default function App() {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState([{ role: "bot", text: "안녕하세요! 질문을 입력해 주세요 😊" }]);
  const [loading, setLoading] = useState(false);

  const [localFaq, setLocalFaq] = useState([]);
  const [faqLoadError, setFaqLoadError] = useState("");
  const [lastDebug, setLastDebug] = useState(null);

  useEffect(() => {
    fetch("/faq-fallback.json")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error("JSON is not an array");
        setLocalFaq(data);
        setFaqLoadError("");
      })
      .catch((e) => {
        setLocalFaq([]);
        setFaqLoadError(String(e?.message || e));
      });
  }, []);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function send() {
    const message = input.trim();
    if (!message) return;

    setMsgs((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setLoading(true);

    // 로컬은 "항상 FAQ" 방식
    if (!localFaq.length) {
      setMsgs((m) => [
        ...m,
        {
          role: "bot",
          text:
            `FAQ를 아직 못 불러왔어요.\n` +
            `- public/faq-fallback.json 위치를 확인해 주세요.\n` +
            `- 지금 오류: ${faqLoadError || "알 수 없음"}\n\n` +
            `브라우저에서 /faq-fallback.json 열었을 때 JSON이 보여야 합니다.`,
        },
      ]);
      setLoading(false);
      return;
    }

    const ranked = rankFaq(message, localFaq, 3);
    const best = ranked[0];

    // ✅ 로컬은 임계치 상관없이 "무조건" 1등 FAQ 답변을 반환
    const reply = best?.item?.a || "FAQ 데이터가 비어있어요.";

    setLastDebug({
      user: message,
      top: ranked.map((x) => ({
        q: x.item.q,
        score: Number(x.score.toFixed(3)),
      })),
    });

    setMsgs((m) => [...m, { role: "bot", text: reply }]);
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 780, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h2 style={{ marginBottom: 8 }}>FAQ 우선 챗봇 (로컬에서 무조건 FAQ)</h2>

      <div style={{ color: "#888", marginBottom: 8 }}>
        localFaq count: <b>{localFaq.length}</b>
        {faqLoadError ? (
          <span style={{ marginLeft: 10, color: "#c00" }}>FAQ 로드 실패: {faqLoadError}</span>
        ) : null}
      </div>

      {lastDebug ? (
        <div
          style={{
            border: "1px dashed #ddd",
            borderRadius: 10,
            padding: 10,
            marginBottom: 12,
            background: "#fafafa",
            fontSize: 13,
            color: "#333",
            whiteSpace: "pre-wrap",
          }}
        >
          <b>매칭 디버그</b>
          {"\n"}질문: {lastDebug.user}
          {"\n"}Top 후보:
          {"\n"}- {lastDebug.top.map((t) => `${t.q} (score ${t.score})`).join("\n- ")}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 12,
          height: 440,
          overflow: "auto",
          background: "#fff",
        }}
      >
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              margin: "8px 0",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #eee",
                background: m.role === "user" ? "#f5f5f5" : "#ffffff",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && <div style={{ color: "#666", marginTop: 8 }}>답변 작성 중...</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSend) send();
          }}
          placeholder="질문을 입력하세요"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
        />
        <button
          onClick={send}
          disabled={!canSend}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: canSend ? "#111" : "#888",
            color: "#fff",
            cursor: canSend ? "pointer" : "not-allowed",
          }}
        >
          보내기
        </button>
      </div>

      <div style={{ marginTop: 12, color: "#666", fontSize: 13 }}>
        확인: 브라우저에서 <b>/faq-fallback.json</b> 이 열리면 FAQ 파일 위치가 정상입니다.
      </div>
    </div>
  );
}