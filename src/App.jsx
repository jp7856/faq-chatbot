import { useEffect, useMemo, useState } from "react";
import "./App.css";

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9가-힣\s]/g, " ") // ✅ 안전: 한글/영문/숫자만
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMatch(query, question) {
  const q = normalize(query);
  const t = normalize(question);
  if (!q || !t) return 0;

  if (t.includes(q)) return 100;

  const qTokens = q.split(" ").filter(Boolean);
  const tSet = new Set(t.split(" ").filter(Boolean));

  let hit = 0;
  for (const tok of qTokens) if (tSet.has(tok)) hit++;

  const ratio = hit / Math.max(1, qTokens.length);
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
    (async () => {
      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        const j = await r.json();

        if (j && j.ok && Array.isArray(j.faqs) && j.faqs.length > 0) {
          setRemoteFaq(j.faqs);
          setSource("remote");
          setErr("");
          return;
        }
        throw new Error("remote faqs empty");
      } catch (e) {
        try {
          const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
          const j2 = await r2.json();
          setLocalFaq(Array.isArray(j2) ? j2 : []);
          setSource("local");
          setErr("");
        } catch (e2) {
          setSource("local");
          setLocalFaq([]);
          setErr(String(e2 && e2.message ? e2.message : e2));
        }
      }
    })();
  }, []);

  const faqList = source === "remote" ? remoteFaq : localFaq;

  const debugInfo = useMemo(() => {
    return { source, count: faqList.length };
  }, [source, faqList.length]);

  function findBestAnswer(userText) {
    if (!faqList.length) return null;

    const scored = faqList
      .map((f) => ({ f, s: scoreMatch(userText, f.q) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);

    const best = scored[0];
    if (!best) return null;

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
            "해당 질문과 딱 맞는 FAQ를 찾지 못했어요 😥\n\n비슷한 질문 예시:\n" +
            result.top
              .filter((x) => x && x.f && x.f.q)
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