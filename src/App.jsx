import { useEffect, useMemo, useState } from "react";
import "./App.css";

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 아주 간단한 유사도(토큰 겹침) — 오타/비슷한 질문도 어느 정도 매칭
function scoreMatch(query, question) {
  const q = normalize(query);
  const t = normalize(question);
  if (!q || !t) return 0;

  if (t.includes(q)) return 100; // 포함이면 강하게

  const qTokens = new Set(q.split(" ").filter(Boolean));
  const tTokens = new Set(t.split(" ").filter(Boolean));
  let hit = 0;
  for (const tok of qTokens) if (tTokens.has(tok)) hit++;

  // 토큰 겹침 비율 + 길이 보정
  const ratio = hit / Math.max(1, qTokens.size);
  return Math.round(ratio * 80);
}

export default function App() {
  const [remoteFaq, setRemoteFaq] = useState([]);
  const [localFaq, setLocalFaq] = useState([]);
  const [source, setSource] = useState("loading"); // loading | remote | local
  const [err, setErr] = useState("");

  const [messages, setMessages] = useState([
    { role: "bot", text: "안녕하세요! 질문을 입력해 주세요 😊" },
  ]);
  const [input, setInput] = useState("");

  useEffect(() => {
    // 1) Cloudflare Pages Functions: /api/faqs (우선)
    (async () => {
      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        const j = await r.json();
        if (j?.ok && Array.isArray(j.faqs) && j.faqs.length > 0) {
          setRemoteFaq(j.faqs);
          setSource("remote");
          setErr("");
          return;
        }
        throw new Error("remote faqs empty");
      } catch (e) {
        // 2) 실패하면 로컬 fallback
        try {
          const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
          const j2 = await r2.json();
          setLocalFaq(Array.isArray(j2) ? j2 : []);
          setSource("local");
          setErr("");
        } catch (e2) {
          setSource("local");
          setLocalFaq([]);
          setErr(String(e2?.message || e2));
        }
      }
    })();
  }, []);

  const faqList = source === "remote" ? remoteFaq : localFaq;

  const debugInfo = useMemo(() => {
    return {
      source,
      count: faqList.length,
    };
  }, [source, faqList.length]);

  function findBestAnswer(userText) {
    if (!faqList.length) return null;

    const scored = faqList
      .map((f) => ({
        f,
        s: scoreMatch(userText, f.q),
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);

    const best = scored[0];
    if (!best) return null;

    // 점수가 너무 낮으면 "못 찾음" 처리
    if (best.s < 25) return { best: null, top: scored };

    return { best: best.f, top: scored };
  }

  function send() {
    const text = input.trim();
    if (!text) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");

    const result = findBestAnswer(text);

    if (!result) {
      setMessages((m) => [
        ...m,
        { role: "bot", text: "FAQ 데이터를 아직 못 불러왔어요. 잠시 후 다시 시도해 주세요." },
      ]);
      return;
    }

    if (!result.best) {
      setMessages((m) => [
        ...m,
        {
          role: "bot",
          text:
            "해당 질문과 딱 맞는 FAQ를 찾지 못했어요 😥\n\n" +
            "비슷한 질문 예시:\n" +
            result.top
              .filter((x) => x?.f?.q)
              .slice(0, 3)
              .map((x) => `- ${x.f.q}`)
              .join("\n"),
        },
      ]);
      return;
    }

    setMessages((m) => [...m, { role: "bot", text: result.best.a }]);
  }

  return (
    <div className="app">
      <h1>FAQ 우선 챗봇</h1>

      <div style={{ marginBottom: 10, fontSize: 13, opacity: 0.8 }}>
        <div>
          <b>source:</b> {debugInfo.source} / <b>count:</b> {debugInfo.count}
        </div>
        {err ? <div style={{ color: "crimson" }}>error: {err}</div> : null}
        <div style={{ marginTop: 4, opacity: 0.7 }}>
          ※ 예쁜 화면은 <code>/</code>이고, <code>/api/faqs</code>는 데이터(JSON) 주소입니다.
        </div>
      </div>

      <div className="chatbox">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text.split("\n").map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>
        ))}
      </div>

      <div className="inputRow">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="질문을 입력하세요"
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button onClick={send}>보내기</button>
      </div>
    </div>
  );
}