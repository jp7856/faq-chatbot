import React, { useEffect, useRef, useState } from "react";
import "./App.css";

const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
};

function normalizeText(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

/* =========================
   인사 감지
========================= */

function isGreeting(text) {
  const t = normalizeText(text);

  const greetings = [
    "안녕",
    "안녕하세요",
    "안녕하십니까",
    "하이",
    "hello",
    "hi",
    "헬로",
    "헬로우",
  ];

  return greetings.some((g) => t.startsWith(g));
}

/* =========================
   Dice 유사도
========================= */

function diceSimilarity(a, b) {
  const A = normalizeText(a);
  const B = normalizeText(b);
  if (!A || !B) return 0;
  if (A === B) return 1;

  const bigrams = (str) => {
    const arr = [];
    for (let i = 0; i < str.length - 1; i++) {
      arr.push(str.slice(i, i + 2));
    }
    return arr;
  };

  const A2 = bigrams(A);
  const B2 = bigrams(B);

  let inter = 0;

  A2.forEach((x) => {
    if (B2.includes(x)) inter++;
  });

  return (2 * inter) / (A2.length + B2.length);
}

/* =========================
   FAQ 스키마 정리
========================= */

function normalizeFaqs(raw) {
  const arr = Array.isArray(raw) ? raw : [];

  return arr
    .map((x) => {
      const q = x?.q ?? x?.question ?? "";
      const a = x?.a ?? x?.answer ?? "";
      return { q: String(q), a: String(a) };
    })
    .filter((x) => x.q && x.a);
}

/* =========================
   FAQ 매칭
========================= */

function hybridScore(q, faqQ) {
  const uq = normalizeText(q);
  const fq = normalizeText(faqQ);

  if (fq.includes(uq) || uq.includes(fq)) return 0.92;

  return diceSimilarity(uq, fq);
}

function pickTopFaqs(userQ, faqs) {
  return [...faqs]
    .map((f) => ({
      ...f,
      score: hybridScore(userQ, f.q),
    }))
    .sort((a, b) => b.score - a.score);
}

/* =========================
   App
========================= */

export default function App() {
  const [faqs, setFaqs] = useState([]);
  const [input, setInput] = useState("");

  const [messages, setMessages] = useState([]);

  const listRef = useRef(null);
  const sendingRef = useRef(false);

  const [theme, setTheme] = useState(
    localStorage.getItem("theme") || "light"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* =========================
     FAQ 로드
  ========================= */

  useEffect(() => {
    async function loadFaqs() {
      try {
        const r = await fetch("/api/faqs");
        const j = await r.json();
        setFaqs(normalizeFaqs(j.faqs || j));
      } catch {
        const r = await fetch("/faq-fallback.json");
        const j = await r.json();
        setFaqs(normalizeFaqs(j));
      }
    }

    loadFaqs();
  }, []);

  function push(role, text) {
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role, text, time: nowHHMM() },
    ]);
  }

  /* =========================
     답변 로직
  ========================= */

  function getAnswer(q) {
    // 1️⃣ 인사 감지
    if (isGreeting(q)) {
      return "안녕하세요. 무엇을 도와드릴까요?";
    }

    // 2️⃣ FAQ 매칭
    const ranked = pickTopFaqs(q, faqs);
    const best = ranked[0];

    if (!best || best.score < 0.1) {
      return "해당 문의에 대한 안내를 찾지 못했습니다.";
    }

    return best.a;
  }

  function sendMessage(textOverride) {
    if (sendingRef.current) return;

    const q = (textOverride ?? input).trim();
    if (!q) return;

    sendingRef.current = true;

    push("user", q);
    setInput("");

    const typingId = crypto.randomUUID();

    setMessages((m) => [
      ...m,
      { id: typingId, role: "bot", text: "…", time: nowHHMM(), typing: true },
    ]);

    setTimeout(() => {
      setMessages((m) => m.filter((x) => x.id !== typingId));

      const answer = getAnswer(q);
      push("bot", answer);

      sendingRef.current = false;
    }, 250);
  }

  return (
    <div className="kakao">
      <header className="topbar">
        <div className="title-main">무엇을 도와드릴까요?</div>

        <div className="topActions">
          <button
            className="modeBtn"
            onClick={() =>
              setTheme((t) => (t === "dark" ? "light" : "dark"))
            }
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
              className={`row ${
                m.role === "user" ? "row-right" : "row-left"
              }`}
            >
              {m.role === "bot" ? (
                <div className="avatar">B</div>
              ) : (
                <div className="avatar ghost" />
              )}

              <div className={`bubble ${m.role}`}>
                <div className="bubbleText">{m.text}</div>
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
              if (e.key === "Enter") sendMessage();
            }}
          />

          <button className="send" onClick={() => sendMessage()}>
            보내기
          </button>
        </div>
      </main>
    </div>
  );
}