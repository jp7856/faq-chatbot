import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

/**
 * Kakao-like FAQ chat (frontend-only)
 * Data source:
 *  1) /api/faqs  (Cloudflare Pages Functions)
 *  2) fallback: /faq-fallback.json (public)
 */

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
    .replace(/[^\p{L}\p{N}\s]/gu, ""); // keep letters/numbers (unicode)
}

// Dice coefficient on character bigrams (works OK for Korean too)
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

function pickTopFaqs(question, faqs, topN = 5) {
  const scored = (faqs || [])
    .map((f) => ({
      ...f,
      _score: diceSimilarity(question, f.q),
    }))
    .sort((x, y) => y._score - x._score);

  return scored.slice(0, topN);
}

export default function App() {
  const [faqs, setFaqs] = useState([]);
  const [source, setSource] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => [
    {
      id: crypto.randomUUID(),
      role: "bot",
      text: "안녕하세요! 질문을 입력해 주세요 😊\n(FAQ에서 가장 비슷한 답을 찾아드려요.)",
      time: nowHHMM(),
    },
  ]);

  const listRef = useRef(null);

  const suggestions = useMemo(() => {
    // show 6 quick buttons from loaded FAQs
    return (faqs || []).slice(0, 6).map((f) => f.q);
  }, [faqs]);

  useEffect(() => {
    // scroll to bottom when new message
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    (async () => {
      setLoadError("");
      // 1) remote /api/faqs
      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok && Array.isArray(j.faqs) && j.faqs.length > 0) {
            setFaqs(j.faqs);
            setSource("remote");
            return;
          }
        }
      } catch (e) {
        // ignore; fallback below
      }

      // 2) local fallback
      try {
        const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
        const j2 = await r2.json();
        if (Array.isArray(j2) && j2.length > 0) {
          setFaqs(j2);
          setSource("fallback");
          return;
        }
        setFaqs([]);
        setSource("empty");
        setLoadError("FAQ 데이터를 불러오지 못했어요. (fallback도 비어있음)");
      } catch (e) {
        setFaqs([]);
        setSource("empty");
        setLoadError("FAQ 데이터를 불러오지 못했어요. (fallback 파일 확인 필요)");
      }
    })();
  }, []);

  function pushMessage(role, text) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text, time: nowHHMM() },
    ]);
  }

  function answerFromFaq(userQ) {
    const top = pickTopFaqs(userQ, faqs, 5);
    const best = top[0];
    const bestScore = best?._score ?? 0;

    // thresholds (tweakable)
    const OK = 0.42; // likely match
    const MAYBE = 0.28; // show suggestions

    if (!best) {
      return {
        type: "none",
        text: "지금은 FAQ가 없어서 답을 못 찾았어요 😵",
        top,
      };
    }

    if (bestScore >= OK) {
      return {
        type: "match",
        text: best.a,
        top,
      };
    }

    if (bestScore >= MAYBE) {
      const list = top
        .slice(0, 3)
        .map((x) => `- ${x.q}`)
        .join("\n");
      return {
        type: "maybe",
        text:
          "딱 맞는 질문은 못 찾았는데, 이 질문들이 비슷해 보여요 🤔\n" +
          list +
          "\n\n원하는 질문을 그대로 눌러보세요!",
        top,
      };
    }

    const list = top
      .slice(0, 3)
      .map((x) => `- ${x.q}`)
      .join("\n");

    return {
      type: "none",
      text:
        "해당 질문과 딱 맞는 FAQ를 찾지 못했어요 🥲\n" +
        "비슷한 질문 예시:\n" +
        list,
      top,
    };
  }

  function handleSend(textOverride) {
    const q = (textOverride ?? input).trim();
    if (!q) return;

    pushMessage("user", q);
    setInput("");

    // bot typing bubble 느낌
    const typingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: typingId, role: "bot", text: "…", time: nowHHMM(), typing: true },
    ]);

    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== typingId));

      if (!faqs?.length) {
        pushMessage(
          "bot",
          "아직 FAQ 데이터를 못 불러왔어요 😵\n잠깐 후 새로고침하거나 fallback 파일을 확인해 주세요."
        );
        return;
      }

      const res = answerFromFaq(q);
      pushMessage("bot", res.text);
    }, 450);
  }

  return (
    <div className="kakao">
      <header className="topbar">
        <div className="title">
          <div className="title-main">FAQ 우선 챗봇</div>
          <div className="title-sub">
            source: <b>{source}</b> / count: <b>{faqs.length}</b>
          </div>
        </div>
      </header>

      <main className="chatWrap">
        <div className="chat" ref={listRef}>
          {loadError ? (
            <div className="systemNotice">
              <b>로드 오류:</b> {loadError}
            </div>
          ) : null}

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

          {suggestions?.length ? (
            <div className="quick">
              {suggestions.map((q) => (
                <button
                  key={q}
                  className="quickBtn"
                  onClick={() => handleSend(q)}
                  title={q}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="composer">
          <input
            className="input"
            placeholder="질문을 입력하세요"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button className="send" onClick={() => handleSend()}>
            보내기
          </button>
        </div>

        <div className="hint">
          ※ 배포 반영은 <b>git push</b> 후 Cloudflare가 다시 빌드해야 적용돼요.
        </div>
      </main>
    </div>
  );
}