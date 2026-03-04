import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// 아주 간단한 유사도(토큰 겹침) — 가볍고 빠르게 FAQ 매칭
function scoreMatch(query, text) {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;

  if (t.includes(q) || q.includes(t)) return 100;

  const qTokens = new Set(q.split(" ").filter(Boolean));
  const tTokens = new Set(t.split(" ").filter(Boolean));

  let hit = 0;
  for (const tok of qTokens) if (tTokens.has(tok)) hit++;

  return (hit / Math.max(1, qTokens.size)) * 80;
}

function pickTopFaqs(query, faqs, k = 3) {
  const scored = faqs
    .map((f) => ({
      ...f,
      _score: Math.max(scoreMatch(query, f.q), scoreMatch(query, f.a)),
    }))
    .sort((a, b) => b._score - a._score);

  return scored.slice(0, k);
}

export default function App() {
  const [remoteFaq, setRemoteFaq] = useState([]);
  const [localFaq, setLocalFaq] = useState([]);
  const [source, setSource] = useState("loading"); // loading | remote | local
  const [error, setError] = useState("");

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => [
    {
      role: "bot",
      text: "안녕하세요! 질문을 입력해 주세요 😊",
    },
  ]);

  const [debug, setDebug] = useState({ q: "", top: [] });

  const chatRef = useRef(null);

  // 스크롤 아래로
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // FAQ 로딩: 1) Pages Function(/api/faqs) → 2) public/faq-fallback.json
  useEffect(() => {
    (async () => {
      setError("");
      setSource("loading");

      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j?.ok && Array.isArray(j.faqs) && j.faqs.length > 0) {
            setRemoteFaq(j.faqs);
            setSource("remote");
            return;
          }
        }
      } catch (e) {
        // ignore
      }

      try {
        const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
        const j2 = await r2.json();
        if (Array.isArray(j2) && j2.length > 0) {
          setLocalFaq(j2);
          setSource("local");
          return;
        }
      } catch (e) {
        setError("FAQ 데이터를 불러오지 못했어요. (public/faq-fallback.json 확인)");
        setSource("local");
        setLocalFaq([]);
      }
    })();
  }, []);

  const faqs = useMemo(() => {
    return source === "remote" ? remoteFaq : localFaq;
  }, [source, remoteFaq, localFaq]);

  function botReplyFor(q) {
    const top = pickTopFaqs(q, faqs, 3);
    setDebug({ q, top: top.map((x) => ({ q: x.q, score: Math.round(x._score) })) });

    const best = top[0];
    if (!best || best._score < 25) {
      return {
        text:
          "해당 질문과 딱 맞는 FAQ를 찾지 못했어요 🥲\n" +
          "비슷한 질문 예시:\n" +
          top
            .filter((x) => x?.q)
            .map((x) => `- ${x.q}`)
            .join("\n"),
        suggestions: top.filter((x) => x?.q).map((x) => x.q).slice(0, 3),
      };
    }

    return {
      text: best.a,
      suggestions: top.filter((x) => x?.q).map((x) => x.q).slice(0, 3),
    };
  }

  function send(text) {
    const q = String(text || "").trim();
    if (!q) return;

    setMessages((m) => [...m, { role: "user", text: q }]);

    const reply = botReplyFor(q);
    setMessages((m) => [
      ...m,
      { role: "user", text: q },
      { role: "bot", text: reply.text, suggestions: reply.suggestions },
    ]);
  }

  function onSubmit(e) {
    e.preventDefault();
    const q = input;
    setInput("");
    send(q);
  }

  return (
    <div className="app">
      <div className="shell">
        <div className="header">
          <div>
            <h1 className="title">FAQ 우선 챗봇</h1>
            <div className="meta">
              source: <b>{source}</b> / count: <b>{faqs.length}</b>
              {error ? ` · ${error}` : ""}
            </div>
          </div>

          <div className="badges">
            <span className="badge">답변은 왼쪽 말풍선</span>
            <span className="badge">질문은 오른쪽 말풍선</span>
          </div>
        </div>

        <div className="main">
          <div className="chat" ref={chatRef}>
            {messages.map((m, idx) => (
              <div key={idx} className={`row ${m.role === "user" ? "user" : "bot"}`}>
                <div className={`bubble ${m.role === "user" ? "user" : "bot"}`}>
                  {m.text}
                  {m.role === "bot" && Array.isArray(m.suggestions) && m.suggestions.length > 0 && (
                    <>
                      <span className="small">추천 질문:</span>
                      <div className="suggestions">
                        {m.suggestions.map((s, i) => (
                          <button
                            key={i}
                            className="chip"
                            type="button"
                            onClick={() => send(s)}
                            title="이 질문으로 바로 보내기"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <aside className="side">
            <p className="kv">매칭 디버그</p>
            <div className="mono">
              질문: {debug.q || "-"}
              {"\n"}
              Top 후보:
              {"\n"}
              {debug.top.length
                ? debug.top.map((x) => `- ${x.q} (score ${x.score})`).join("\n")
                : "-"}
            </div>
            <p className="kv" style={{ marginTop: 12 }}>
              팁: 정확히 못 맞추면 “추천 질문” 버튼을 눌러보세요.
            </p>
          </aside>
        </div>

        <div className="footer">
          <form className="form" onSubmit={onSubmit}>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="질문을 입력하세요"
            />
            <button className="btn" type="submit" disabled={!input.trim()}>
              보내기
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}