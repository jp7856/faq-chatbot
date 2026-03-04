import React, { useEffect, useMemo, useRef, useState } from "react";
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

function tokenize(s) {
  const t = normalizeText(s);
  if (!t) return [];
  return t.split(" ").filter(Boolean);
}

function jaccardTokens(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// ✅ {q,a} / {question,answer} 혼용 정규화
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

/**
 * ✅ 정확도 핵심:
 * - dice(문자 bigram) + jaccard(단어) 혼합
 * - "부분 포함"이면 강력하게 매칭 점수 올림
 *   예: "환불" -> "환불 정책" / "환불 방법" 같은 질문에 0.9 이상
 */
function hybridScore(userQ, faqQ) {
  const uq = normalizeText(userQ);
  const fq = normalizeText(faqQ);
  if (!uq || !fq) return 0;
  if (uq === fq) return 1;

  // 부분 포함이면 거의 확정 매칭
  // (짧은 키워드 입력 대응: "환불", "결제", "배송" 등)
  if (fq.includes(uq) || uq.includes(fq)) return 0.92;

  const d = diceSimilarity(uq, fq);
  const j = jaccardTokens(uq, fq);

  // 짧은 입력일수록 단어기반이 약해지므로 dice 가중을 조금 더
  const len = uq.length;
  const wd = len <= 3 ? 0.85 : 0.65;
  const wj = 1 - wd;

  return wd * d + wj * j;
}

function pickTopFaqs(userQ, faqs, topN = 5) {
  return (faqs || [])
    .map((f) => ({ ...f, _score: hybridScore(userQ, f.q) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, topN);
}

export default function App() {
  const [faqs, setFaqs] = useState([]);
  const [source, setSource] = useState("loading");
  const [loadError, setLoadError] = useState("");

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("theme") || "light";
  });

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => [
    {
      id: crypto.randomUUID(),
      role: "bot",
      text: "안녕하세요! 질문을 입력해 주세요 😊",
      time: nowHHMM(),
    },
  ]);

  const [suggestBtns, setSuggestBtns] = useState([]); // ✅ 질문별 추천 버튼(top3)
  const listRef = useRef(null);
  const sendingRef = useRef(false);

  // ✅ 테마 적용/저장
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // ✅ 스크롤 유지
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ✅ FAQ 로드
  useEffect(() => {
    (async () => {
      setLoadError("");

      try {
        const r = await fetch("/api/faqs", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const normalized = normalizeFaqs(j?.faqs ?? j);
          if ((j?.ok ?? true) && normalized.length > 0) {
            setFaqs(normalized);
            setSource("remote");
            return;
          }
        }
      } catch (e) {}

      try {
        const r2 = await fetch("/faq-fallback.json", { cache: "no-store" });
        const j2 = await r2.json();
        const normalized2 = normalizeFaqs(j2);
        if (normalized2.length > 0) {
          setFaqs(normalized2);
          setSource("fallback");
          return;
        }
        setFaqs([]);
        setSource("empty");
        setLoadError("FAQ 데이터를 불러오지 못했어요.");
      } catch (e) {
        setFaqs([]);
        setSource("empty");
        setLoadError("FAQ 데이터를 불러오지 못했어요.");
      }
    })();
  }, []);

  function pushMessage(role, text) {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text, time: nowHHMM() },
    ]);
  }

  function getAnswer(userQ) {
    const top = pickTopFaqs(userQ, faqs, 5);
    const best = top[0];
    const bestScore = best?._score ?? 0;

    // ✅ 추천 버튼은 "비슷한 형태"면 보여줘도 된다고 했으니,
    //    최소 점수 이상인 후보들을 top3로 버튼화
    const btns = top
      .filter((x) => x._score >= 0.12) // 너무 엉뚱한 건 제외
      .slice(0, 3)
      .map((x) => x.q);

    // ✅ 답변은 "이상한 문구 없이" 바로 답만
    // - 확실: bestScore 높거나 부분포함이면 이미 0.92 들어옴
    // - 애매: 그래도 best가 있으면 best.a를 답으로 주고, 버튼으로 선택 유도
    if (!best) {
      return {
        answer: "해당 문의에 대한 안내를 찾지 못했어요.",
        btns: [],
      };
    }

    // 아주 낮은 점수면 답변 품질이 나쁠 수 있어서 최소 방어
    // 하지만 사용자가 "비슷한 형태 문의면 보여줘도 됨"이라 했으니
    // bestScore가 아주 낮을 때만 안내문.
    if (bestScore < 0.10) {
      return {
        answer: "해당 문의에 대한 안내를 찾지 못했어요.",
        btns,
      };
    }

    return {
      answer: best.a,
      btns,
    };
  }

  function handleSend(textOverride) {
    if (sendingRef.current) return;

    const q = (textOverride ?? input).trim();
    if (!q) return;

    sendingRef.current = true;
    pushMessage("user", q);
    setInput("");

    const typingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: typingId, role: "bot", text: "…", time: nowHHMM(), typing: true },
    ]);

    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== typingId));

      if (!faqs?.length) {
        pushMessage("bot", "FAQ 데이터를 아직 불러오지 못했어요.");
        setSuggestBtns([]);
        sendingRef.current = false;
        return;
      }

      const { answer, btns } = getAnswer(q);
      setSuggestBtns(btns);
      pushMessage("bot", answer);

      sendingRef.current = false;
    }, 250);
  }

  // ✅ 첫 화면용(옵션) 빠른 버튼 6개: 원하면 유지, 싫으면 아래 블록 삭제 가능
  const quickSuggestions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    for (const f of faqs || []) {
      const q = f?.q;
      if (!q) continue;
      if (seen.has(q)) continue;
      seen.add(q);
      uniq.push(q);
      if (uniq.length >= 6) break;
    }
    return uniq;
  }, [faqs]);

  return (
    <div className="kakao">
      <header className="topbar">
        <div className="title">
          <div className="title-main">FAQ 우선 챗봇</div>
          <div className="title-sub">
            source: <b>{source}</b> / count: <b>{faqs.length}</b>
          </div>
        </div>

        {/* ✅ 다크/라이트 토글 */}
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
          {loadError ? <div className="systemNotice">{loadError}</div> : null}

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

          {/* ✅ 질문별 “비슷한 문의” 버튼 (텍스트로 길게 안내 안 함) */}
          {suggestBtns?.length ? (
            <div className="quick">
              {suggestBtns.map((q) => (
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

          {/* ✅ (옵션) 기본 빠른 버튼 */}
          {quickSuggestions?.length ? (
            <div className="quick">
              {quickSuggestions.map((q) => (
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

        <div className="hint">
          ※ 배포 반영은 <b>git push</b> 후 Cloudflare가 다시 빌드해야 적용돼요.
        </div>
      </main>
    </div>
  );
}