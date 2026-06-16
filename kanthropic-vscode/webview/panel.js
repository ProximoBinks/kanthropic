// kanthropic panel webview — pure presentation. All grading + persistence
// happens in the extension host; this just renders cards and forwards answers.
(function () {
  const vscode = acquireVsCodeApi();
  const glyphEl = document.getElementById("glyph");
  const answerEl = document.getElementById("answer");
  const cardEl = document.getElementById("card");
  const inputEl = document.getElementById("input");
  const formEl = document.getElementById("form");
  const scoreEl = document.getElementById("score");

  let phase = "input"; // "input" | "correct" | "wrong"
  let correct = 0;
  let streak = 0;

  function renderScore() {
    scoreEl.textContent = `${correct} ✓ · streak ${streak}`;
  }

  function showCard(glyph) {
    phase = "input";
    glyphEl.textContent = glyph;
    answerEl.textContent = "";
    answerEl.classList.remove("show");
    cardEl.classList.remove("correct", "wrong");
    inputEl.value = "";
    inputEl.disabled = false;
    inputEl.focus();
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (phase === "wrong") { vscode.postMessage({ type: "next" }); return; }
    if (phase === "correct") return; // ignore during the green flash
    vscode.postMessage({ type: "answer", text: inputEl.value });
    inputEl.disabled = true;
  });

  // Keep the keyboard ready: refocus whenever the panel regains focus.
  window.addEventListener("focus", () => inputEl.focus());

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "card") {
      showCard(msg.glyph);
    } else if (msg.type === "result") {
      if (msg.correct) {
        phase = "correct";
        correct++; streak++; renderScore();
        cardEl.classList.add("correct");
        setTimeout(() => vscode.postMessage({ type: "next" }), 430);
      } else {
        phase = "wrong";
        streak = 0; renderScore();
        cardEl.classList.add("wrong");
        answerEl.innerHTML = `= <span class="romaji">${msg.romaji}</span>`;
        answerEl.classList.add("show");
        inputEl.disabled = false;
        inputEl.value = "";
        inputEl.focus(); // Enter again advances to the next card
      }
    }
  });

  renderScore();
  vscode.postMessage({ type: "ready" });
})();
