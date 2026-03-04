import React, { useEffect, useRef, useState } from "react";
import "./App.css";

// --- utils ---
const nowHHMM = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
};

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”‘’"'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

// Dice coefficient on character bigrams (Korean OK)
function diceSimilarity(a, b) {
  const A = normalizeText(a);
  const B = normalizeText(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;

  const bigrams = (str) => {
    const m = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  };

  const mA = bigrams(A);
  const mB = bigrams(B);

  let inter = 0;
  for (const [bg, cntA] of mA.entries()) {
    const cntB = mB.get(bg) || 0;
    inter += Math.min(cntA, cntB);
  }
  const sizeA = Array.from(mA.values()).reduce((s, v) => s + v, 0);
  const sizeB = Array.from(mB.values()).reduce((s, v) => s + v, 0);
  return (2 * inter) / (sizeA + sizeB);
}

// 스키마 정규화: {q,a} / {question,answer} 혼용 대응
function normalizeFaqs(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => {
      const q = x?.q ?? x?.question ?? x?.Q ?? x?.title ?? "";
      const a = x?.a ?? x?.answer ?? x?.A ?? x?.content ?? "";
      return { q: String(q).trim(), a: String(a).trim() };
    })
    .filter((x) => x.q && x.a);
}

// 짧은 키워드(예: "환불")도 "환불 정책"으로 강하게 매칭
function hybridScore(userQ, faqQ) {
  const uq = normalizeText(userQ);
  const fq = normalizeText(faqQ);
  if (!uq || !fq) return 0;
  if (uq === fq) return 1;

  // 부분 포함이면 거의 확정 매칭
  if (fq.includes(uq) || uq.includes(fq)) return 0.92;

  return diceSimilarity(uq, fq);
}

function pickTopFaqs(userQ, faqs, topN = 5) {
  return (faqs || [])
    .map((f) => ({ ...f, _score: hybridScore(userQ, f.q) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);
}

export default function App() {
  const [faqs, setFaqs] = useState([]);
  const [input, setInput] = useState("");

  // ✅ 기본 가이드 말풍선 제거: 빈 배열 시작
  const [messages, setMessages] = useState(() => []);

  const listRef = useRef(null);
  const sendingRef = useRef(false);

  // ✅ 다크/화이트 토글
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // 스크롤 유지
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // FAQ 로드
  useEffect(() => {
    (async () => {
      // 1) /api/faqs
      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const normalized = normalizeFaqs(j?.faqs ?? j);
          if (normalized.length) {
            setFaqs(normalized);
            return;
          }
        }
      } catch (e) {}

      // 2) fallback
      try {
        const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
        const j2 = await r2.json();
        const normalized2 = normalizeFaqs(j2);
        if (normalized2.length) {
          setFaqs(normalized2);
          return;
        }
      } catch (e) {}

      setFaqs([]);
    })();
  }, []);

  function push(role, text) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text, time: nowHHMM() },
    ]);
  }

  function getAnswer(userQ) {
    if (!faqs?.length) return "FAQ 데이터를 아직 불러오지 못했어요.";

    const top = pickTopFaqs(userQ, faqs, 5);
    const best = top[0];
    const bestScore = best?._score ?? 0;

    if (!best || bestScore < 0.1) return "해당 문의에 대한 안내를 찾지 못했습니다.";
    return best.a;
  }

  function handleSend(textOverride) {
    if (sendingRef.current) return;

    const q = (textOverride ?? input).trim();
    if (!q) return;

    sendingRef.current = true;

    push("user", q);
    setInput("");

    const typingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: typingId, role: "bot", text: "…", time: nowHHMM(), typing: true },
    ]);

    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== typingId));

      const answer = getAnswer(q);
      push("bot", answer);

      sendingRef.current = false;
    }, 250);
  }

  return (
    <div className="kakao">
      <header className="topbar">
        {/* ✅ 상단 흰색 바: 한 줄만 */}
        <div className="title">
          <div className="title-main">무엇을 도와드릴까요?</div>
        </div>

        <div className="topActions">
          <button
            className="modeBtn"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="테마 전환"
          >
            {theme === "dark" ? "화이트 모드" : "다크 모드"}
          </button>
        </div>
      </header>

      <main className="chatWrap">
        <div className="chat" ref={listRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`row ${m.role === "user" ? "row-right" : "row-left"}`}
            >
              {m.role === "bot" ? (
                <div className="avatar" title="bot">
                  B
                </div>
              ) : (
                <div className="avatar ghost" />
              )}

              <div className={`bubble ${m.role}`}>
                <div className={`bubbleTail ${m.role}`} />
                <div className={`bubbleText ${m.typing ? "typing" : ""}`}>
                  {m.text}
                </div>
              </div>

              <div className="time">{m.time}</div>
            </div>
          ))}
        </div>

        <div className="composer">
          <input
            className="input"
            placeholder="질문을 입력하세요"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent?.isComposing) return;
              if (e.key === "Enter" && !e.repeat) handleSend();
            }}
          />
          <button
            className="send"
            onClick={() => handleSend()}
            disabled={sendingRef.current}
            aria-disabled={sendingRef.current}
          >
            보내기
          </button>
        </div>
      </main>
    </div>
  );
}