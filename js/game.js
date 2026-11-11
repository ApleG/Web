/* ============================================================
   《西迁长卷》交互逻辑
   ============================================================ */

(function () {
  "use strict";

  const C = window.GAME_CONTENT;
  const STORAGE_KEY = "xqcj_save_v2";
  const TOTAL_SCENES = C.scenes.length;
  const statsMeta = [
    { key: "truth", label: C.ui.statsTruth },
    { key: "duty", label: C.ui.statsDuty },
    { key: "grit", label: C.ui.statsGrit }
  ];

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function personalize(value) {
    const author = C.meta.author;
    return String(value == null ? "" : value)
      .replace(/〔请填写姓名〕/g, () => author.name)
      .replace(/〔请填写学号〕/g, () => author.studentId)
      .replace(/〔请填写班级〕/g, () => author.className)
      .replace(/〔请填写任课教师〕/g, () => author.teacher);
  }

  function escapeHtml(value) {
    return personalize(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getPath(object, path) {
    return path.split(".").reduce((result, part) => (result == null ? undefined : result[part]), object);
  }

  function format(template, values) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) =>
      values && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    );
  }

  function freshState() {
    return {
      screen: "cover",
      started: false,
      ended: false,
      sceneIndex: -1,
      phase: "cover",
      stats: { truth: 0, duty: 0, grit: 0 },
      historyCount: 0,
      decisions: [],
      pendingChoiceId: null,
      sceneOrders: {},
      flags: [],
      branchId: null,
      endingId: null,
      cycle: 1,
      completions: 0,
      endings: [],
      memoryFound: false,
      note: ""
    };
  }

  function normalizeState(raw) {
    const base = freshState();
    if (!raw || typeof raw !== "object") return base;
    const merged = Object.assign({}, base, raw);
    merged.stats = Object.assign({}, base.stats, raw.stats || {});
    merged.decisions = Array.isArray(raw.decisions) ? raw.decisions.slice() : [];
    merged.endings = Array.isArray(raw.endings) ? raw.endings.slice() : [];
    merged.sceneOrders = raw.sceneOrders && typeof raw.sceneOrders === "object" ? raw.sceneOrders : {};
    merged.flags = Array.isArray(raw.flags) ? raw.flags.slice() : [];
    merged.branchId = raw.branchId || null;
    if (typeof merged.sceneIndex !== "number") merged.sceneIndex = -1;
    if (!merged.phase) merged.phase = "cover";
    return merged;
  }

  let state = loadState() || freshState();
  let soundOn = false;
  let audioEngine = null;
  let toastTimer = null;
  let openLayers = new Set();

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? normalizeState(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* 本地存储不可用时，游戏仍可在当前页面继续。 */
    }
  }

  function isInProgress() {
    return !!state.started && !state.ended && state.phase !== "cover";
  }

  function currentScene() {
    return C.scenes[state.sceneIndex] || null;
  }

  function selectedChoice(scene) {
    if (!scene || !state.pendingChoiceId) return null;
    return visibleChoices(scene).find((choice) => choice.id === state.pendingChoiceId) || null;
  }

  function visibleChoices(scene) {
    if (!scene) return [];
    let list = scene.choices.filter((choice) => !choice.memoryOnly);

    if (state.cycle >= 2) {
      const memory = scene.choices.find((choice) => choice.memoryOnly);
      if (memory) {
        const replaceIndex = list.findIndex((choice) => choice.id === memory.replaces);
        if (replaceIndex >= 0) {
          list[replaceIndex] = memory;
        } else {
          list = list.concat(memory);
        }
      }
    }

    if (scene.hiddenChoice && state.cycle >= 3 && state.memoryFound) {
      list = list.map((choice) => (choice.id === "d" ? scene.hiddenChoice : choice));
    }

    return list.slice(0, 4);
  }

  function shuffle(list) {
    const result = list.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }
    return result;
  }

  function narrativeForScene(scene) {
    const base = scene.narrative.slice();
    const variants = (scene.variants || [])
      .filter((variant) => state.flags.includes(variant.when))
      .slice(0, 2);

    if (!variants.length) return base;

    const insertAt = Math.min(1, Math.max(0, base.length - 1));
    return base.slice(0, insertAt).concat(variants.map((variant) => variant.text), base.slice(insertAt));
  }

  function orderedChoices(scene) {
    const base = visibleChoices(scene);
    const ids = base.map((choice) => choice.id);
    let order = state.sceneOrders[scene.id];

    if (
      !Array.isArray(order) ||
      order.length !== ids.length ||
      !order.every((id) => ids.includes(id))
    ) {
      order = shuffle(ids);
      if (order.length > 1 && order.every((id, index) => id === ids[index])) {
        order.push(order.shift());
      }
      state.sceneOrders[scene.id] = order;
      saveState();
    }

    return order.map((id) => base.find((choice) => choice.id === id));
  }

  /* ======================= 基础界面 ======================= */

  function bindStaticCopy() {
    $$("[data-bind]").forEach((element) => {
      const value = getPath(C, element.getAttribute("data-bind"));
      if (typeof value === "string") element.textContent = personalize(value);
    });

    $$("[data-bind-placeholder]").forEach((element) => {
      const value = getPath(C, element.getAttribute("data-bind-placeholder"));
      if (typeof value === "string") element.setAttribute("placeholder", value);
    });

    $("#coverMeta").innerHTML = C.cover.meta.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    $("#coverRoute").innerHTML = C.cover.route
      .map((stop) => `<span class="route-stop">${escapeHtml(stop)}</span>`)
      .join("");
    $("#footerLine1").textContent = personalize(C.footer.line1);
    $("#footerLine2").textContent = personalize(C.footer.line2);
    $("#footerLine3").textContent = personalize(C.footer.line3);
  }

  function updateChrome() {
    const runBadge = $("#runBadge");
    if (runBadge) runBadge.textContent = format(C.ui.cycle, { n: state.cycle });
    $("#soundBtn").setAttribute("aria-pressed", soundOn ? "true" : "false");
    $("#soundBtnText").textContent = soundOn ? C.ui.soundOn : C.ui.soundOff;
  }

  function hideAllScreens() {
    $("#coverScreen").hidden = true;
    $("#gameScreen").hidden = true;
    $("#endingScreen").hidden = true;
  }

  function renderCover() {
    hideAllScreens();
    $("#coverScreen").hidden = false;
    document.body.dataset.screen = "cover";
    updateChrome();

    const startBtn = $("#startBtn");
    const resumeBtn = $("#resumeBtn");
    const restartBtn = $("#coverRestartBtn");

    if (state.ended) {
      startBtn.textContent = C.ui.replay;
      startBtn.hidden = false;
      resumeBtn.hidden = true;
      restartBtn.hidden = true;
    } else if (isInProgress()) {
      startBtn.textContent = C.ui.restart;
      startBtn.hidden = false;
      resumeBtn.textContent = C.ui.resumeSave;
      resumeBtn.hidden = false;
      restartBtn.hidden = false;
    } else {
      startBtn.textContent = C.cover.start;
      startBtn.hidden = false;
      resumeBtn.hidden = true;
      restartBtn.hidden = true;
    }

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function showGameScreen() {
    hideAllScreens();
    $("#gameScreen").hidden = false;
    document.body.dataset.screen = "game";
  }

  function renderRoute(activeIndex) {
    $("#routeRail").innerHTML = C.cover.route
      .map((stop, index) => {
        const classes = ["route-stop"];
        if (index < activeIndex) classes.push("is-done");
        if (index === activeIndex) classes.push("is-current");
        return `<span class="${classes.join(" ")}"><span class="route-dot"></span><span>${escapeHtml(stop)}</span></span>`;
      })
      .join("");
  }

  /* ======================= 序章 ======================= */

  function startJourney() {
    state.started = true;
    state.ended = false;
    state.screen = "game";
    state.sceneIndex = -1;
    state.phase = "prologue";
    state.pendingChoiceId = null;
    state.endingId = null;
    state.stats = { truth: 0, duty: 0, grit: 0 };
    state.historyCount = 0;
    state.decisions = [];
    state.sceneOrders = {};
    state.flags = [];
    state.branchId = null;
    saveState();
    renderPrologue();
  }

  function renderPrologue() {
    showGameScreen();
    updateChrome();
    const prologue = C.prologue;

    $("#sceneArt").innerHTML = sceneArtSVG("hangzhou");
    $("#sceneArchive").textContent = C.ui.sceneArchivePrologue;
    $("#sceneChapter").textContent = prologue.chapter;
    $("#sceneTitle").textContent = prologue.title;
    $("#sceneTitle").classList.toggle("is-long", prologue.title.length > 6);
    $("#scenePlace").textContent = prologue.place;
    $(".scene-epigraph").hidden = false;
    $("#sceneEpigraph").textContent = prologue.quote;
    $("#sceneEpigraphFrom").textContent = prologue.quoteFrom;
    $("#sceneDate").textContent = prologue.date;
    $("#sceneProgressText").textContent = C.ui.prologueMeter;
    renderRoute(-1);

    $("#narrative").innerHTML = prologue.paragraphs
      .map((paragraph, index) => `<p style="--i:${index}">${escapeHtml(paragraph)}</p>`)
      .join("");
    $("#choicePrompt").textContent = "";
    $("#choiceList").innerHTML = `<button class="btn btn-primary btn-large prologue-action" type="button" data-action="prologue-continue">${escapeHtml(prologue.cta)}</button>`;
    $("#choiceBlock").hidden = false;
    $("#echoBlock").hidden = true;
    $("#readingScroll").scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function enterFirstScene() {
    state.sceneIndex = 0;
    state.phase = "choice";
    state.pendingChoiceId = null;
    saveState();
    renderScene();
  }

  /* ======================= 剧情场景 ======================= */

  function renderScene() {
    const scene = currentScene();
    if (!scene) {
      renderCover();
      return;
    }

    showGameScreen();
    updateChrome();
    $("#sceneArt").innerHTML = sceneArtSVG(scene.art);
    $("#sceneArchive").textContent = format(C.ui.sceneArchiveLabel, {
      n: String(state.sceneIndex + 1).padStart(2, "0")
    });
    $("#sceneChapter").textContent = scene.chapter;
    $("#sceneTitle").textContent = scene.title;
    $("#sceneTitle").classList.toggle("is-long", scene.title.length > 6);
    $("#scenePlace").textContent = scene.place;
    $(".scene-epigraph").hidden = false;
    $("#sceneEpigraph").textContent = scene.epigraph;
    $("#sceneEpigraphFrom").textContent = scene.epigraphFrom;
    $("#sceneDate").textContent = scene.date;
    $("#sceneProgressText").textContent = format(C.ui.chapterMeter, { n: state.sceneIndex + 1 });
    renderRoute(scene.routeIndex);

    $("#narrative").innerHTML = narrativeForScene(scene)
      .map((paragraph, index) => `<p style="--i:${index}">${escapeHtml(paragraph)}</p>`)
      .join("");

    if (state.phase === "echo" && selectedChoice(scene)) {
      renderEcho(scene, selectedChoice(scene));
    } else {
      renderChoices(scene);
    }

    $("#readingScroll").scrollTop = 0;
  }

  function enterBranch(branchId) {
    if (!C.branches || !C.branches[branchId]) return;
    state.branchId = branchId;
    state.phase = "branch";
    saveState();
    renderBranch();
  }

  function renderBranch() {
    const branch = C.branches && C.branches[state.branchId];
    if (!branch) {
      renderCover();
      return;
    }

    showGameScreen();
    updateChrome();
    $("#sceneArt").innerHTML = sceneArtSVG(branch.art);
    $("#sceneArchive").textContent = branch.archive;
    $("#sceneChapter").textContent = branch.chapter;
    $("#sceneTitle").textContent = branch.title;
    $("#sceneTitle").classList.toggle("is-long", branch.title.length > 6);
    $("#scenePlace").textContent = branch.place;
    $(".scene-epigraph").hidden = true;
    $("#sceneEpigraph").textContent = "";
    $("#sceneEpigraphFrom").textContent = "";
    $("#sceneDate").textContent = branch.date;
    $("#sceneProgressText").textContent = C.ui.branchMeter;
    renderRoute(branch.routeIndex);

    $("#narrative").innerHTML = branch.narrative
      .map((paragraph, index) => `<p style="--i:${index}">${escapeHtml(paragraph)}</p>`)
      .join("");

    $("#choiceBlock").hidden = false;
    $("#echoBlock").hidden = true;
    $("#choicePrompt").textContent = branch.prompt;
    $("#choiceList").innerHTML = `<button class="btn btn-primary btn-large prologue-action" type="button" data-action="branch-ending">${escapeHtml(branch.cta)}</button>`;
    $("#readingScroll").scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderChoices(scene) {
    const choices = orderedChoices(scene);
    $("#choiceBlock").hidden = false;
    $("#echoBlock").hidden = true;
    $("#choicePrompt").textContent = scene.prompt;
    $("#choiceList").innerHTML = choices
      .map((choice, index) => {
        return `
          <button class="choice" type="button" data-choice-id="${escapeHtml(choice.id)}" aria-label="${escapeHtml(choice.label)}">
            <span class="choice-key">${String.fromCharCode(65 + index)}</span>
            <span class="choice-copy">
              <span class="choice-label">${escapeHtml(choice.label)}</span>
            </span>
            <span class="choice-arrow" aria-hidden="true">→</span>
          </button>`;
      })
      .join("");
  }

  function renderEcho(scene, choice) {
    $("#choiceBlock").hidden = true;
    $("#echoBlock").hidden = false;
    $("#echoChoice").textContent = `${choice.label}`;
    $("#echoText").innerHTML = `<p>${escapeHtml(choice.echo)}</p>`;
    $("#historyNote").innerHTML = `<p>${escapeHtml(scene.historyNote)}</p>`;
    $("#continueBtn").textContent = state.sceneIndex === TOTAL_SCENES - 1 ? C.ui.toEnding : C.ui.continue;

    window.setTimeout(() => {
      $("#echoBlock").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
  }

  function chooseOption(choiceId) {
    if (state.phase !== "choice") return;
    const scene = currentScene();
    if (!scene) return;
    const choice = visibleChoices(scene).find((item) => item.id === choiceId);
    if (!choice) return;

    statsMeta.forEach((item) => {
      const delta = Number(choice.stats && choice.stats[item.key] ? choice.stats[item.key] : 0);
      state.stats[item.key] = Math.max(0, Number(state.stats[item.key] || 0) + delta);
    });
    if (choice.history) state.historyCount += 1;
    if (choice.memory) state.memoryFound = true;

    const flagKey = `${scene.id}:${choice.id}`;
    if (!state.flags.includes(flagKey)) state.flags.push(flagKey);

    state.decisions.push({
      sceneId: scene.id,
      chapter: scene.chapter,
      title: scene.title,
      date: scene.date,
      choiceId: choice.id,
      choiceLabel: choice.label,
      history: !!choice.history,
      memory: !!choice.memory,
      endingType: choice.endingType || null
    });
    state.pendingChoiceId = choice.id;
    state.phase = "echo";
    saveState();
    renderScene();
  }

  function goNext() {
    if (state.phase !== "echo") return;
    const scene = currentScene();
    const choice = selectedChoice(scene);
    if (choice && choice.branch) {
      enterBranch(choice.branch);
      return;
    }
    if (state.sceneIndex >= TOTAL_SCENES - 1) {
      resolveEnding();
      return;
    }
    state.sceneIndex += 1;
    state.phase = "choice";
    state.pendingChoiceId = null;
    saveState();
    renderScene();
  }

  /* ======================= 结局 ======================= */

  function finishEnding(endingId) {
    const isNew = !state.endings.includes(endingId);
    if (isNew) state.endings.push(endingId);

    state.endingId = endingId;
    state.ended = true;
    state.screen = "ending";
    state.phase = "ending";
    state.completions += 1;
    saveState();
    renderEnding(endingId);
    if (isNew) showToast(C.ui.endingUnlock);
  }

  function resolveEnding() {
    const scene = currentScene();
    const choice = selectedChoice(scene);
    if (!choice) return;

    let endingId = "bad_empty";
    if (choice.endingType === "hidden") {
      endingId = "hidden";
    } else if (choice.endingType === "bad") {
      endingId = choice.id === "c" ? "bad_leave" : "bad_letter";
    } else if (choice.endingType === "good") {
      endingId = state.stats.duty + state.stats.truth >= 12 ? "good" : "bad_empty";
    } else if (choice.endingType === "history") {
      endingId = state.historyCount >= 5 ? "true_history" : "bad_empty";
    }

    finishEnding(endingId);
  }

  function resolveBranchEnding() {
    const branch = C.branches && C.branches[state.branchId];
    if (!branch) return;
    finishEnding(branch.endingId);
  }

  function renderEnding(endingId) {
    const ending = C.endings[endingId];
    if (!ending) return;

    hideAllScreens();
    $("#endingScreen").hidden = false;
    document.body.dataset.screen = "ending";
    updateChrome();

    $("#endingArt").innerHTML = endingArtSVG(ending.tone);
    $("#endingKicker").textContent = ending.kicker;
    $("#endingTitle").textContent = ending.title;
    $("#endingSubtitle").textContent = ending.subtitle;
    $("#endingQuote").innerHTML = `${escapeHtml(ending.quote)}<cite>${escapeHtml(ending.quoteFrom)}</cite>`;
    $("#endingParagraphs").innerHTML = ending.paragraphs
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("");
    $("#endingStatsNote").textContent = ending.statsNote;

    $("#endingStats").innerHTML = statsMeta
      .map(
        (item) =>
          `<span class="ending-stat"><strong>${Math.max(0, Number(state.stats[item.key] || 0))}</strong><span>${escapeHtml(item.label)}</span></span>`
      )
      .join("");
    $("#endingRun").textContent = format(C.ui.endingRun, {
      cycle: state.cycle,
      unlocked: state.endings.length
    });

    $("#endingHistoryLabel").textContent = C.ui.endingHistoryLabel;
    $("#endingHistoryBox").innerHTML = ending.historyBox
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    const reading = C.readings && C.readings[endingId];
    if (reading) {
      $("#articleCardTitle").textContent = reading.title;
      $("#articleCardDesc").textContent = reading.teaser;
    }

    renderEndingTimeline();

    const noteBox = $("#playerNoteBox");
    noteBox.hidden = endingId !== "hidden";
    if (endingId === "hidden") {
      $("#playerNoteInput").value = state.note || "";
      $("#noteSaved").hidden = !state.note;
    }

    $("#replayBtn").textContent = C.ui.replay;
    $("#readArticleBtn").textContent = C.ui.readArticle;

    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderEndingTimeline() {
    const timeline = $("#endingTimeline");
    if (!state.decisions.length) {
      timeline.innerHTML = "";
      return;
    }
    timeline.innerHTML = `
      <h3>${escapeHtml(C.ui.endingTimeline)}</h3>
      ${state.decisions
        .map(
          (decision) => `
          <div class="timeline-item">
            <span class="timeline-num" aria-hidden="true"></span>
            <div class="timeline-body">
              <span class="timeline-scene">${escapeHtml(decision.chapter)} · ${escapeHtml(decision.title)}</span>
              <span class="timeline-choice">${escapeHtml(decision.choiceLabel)}</span>
            </div>
          </div>`
        )
        .join("")}
    `;
  }

  function replay() {
    const nextCycle = state.cycle + 1;
    const preserved = {
      cycle: nextCycle,
      completions: state.completions,
      endings: state.endings.slice(),
      memoryFound: state.memoryFound,
      note: state.note
    };
    state = Object.assign(freshState(), preserved);
    startJourney();
    showToast(format(C.ui.cycleStart, { n: nextCycle }));
  }

  /* ======================= 图鉴 / 关于 / 选择记录 ======================= */

  function openGallery() {
    const unlocked = state.endings.length;
    $("#galleryLead").textContent = format(C.ui.galleryLead, {
      unlocked,
      cycle: state.cycle
    });

    $("#galleryGrid").innerHTML = C.gallery.order
      .map((id) => {
        const ending = C.endings[id];
        const isUnlocked = state.endings.includes(id);
        const isHidden = id === "hidden";
        const classes = ["gallery-item"];
        if (isUnlocked) classes.push("is-unlocked");
        if (isHidden) classes.push("is-hidden-end");

        return `
          <article class="${classes.join(" ")}">
            <span class="gallery-tag">${isUnlocked ? escapeHtml(C.gallery.labels[id] || ending.kicker) : escapeHtml(C.ui.galleryMystery)}</span>
            <h3 class="gallery-title">${isUnlocked ? escapeHtml(ending.title) : escapeHtml(C.ui.galleryMystery)}</h3>
            <p class="gallery-hint">${isUnlocked ? escapeHtml(ending.subtitle) : escapeHtml(C.gallery.hints[id])}</p>
            ${isUnlocked ? `<span class="gallery-locked">${escapeHtml(C.ui.galleryOwned)}</span>` : ""}
          </article>`;
      })
      .join("");

    $("#galleryFootnote").textContent = C.ui.galleryHint;
    openLayer("galleryModal");
  }

  function renderAbout() {
    $("#aboutBody").innerHTML = C.about.sections
      .map(
        (section) => `
        <section class="about-section">
          <h3>${escapeHtml(section.heading)}</h3>
          ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </section>`
      )
      .join("");
  }

  function openAbout() {
    openLayer("aboutModal");
  }

  function openHistory() {
    const log = $("#historyLog");
    if (!state.decisions.length) {
      log.innerHTML = `<p class="history-log-empty">${escapeHtml(C.ui.historyEmpty)}</p>`;
    } else {
      log.innerHTML = state.decisions
        .map(
          (decision) => `
          <div class="history-log-item">
            <span class="history-log-scene">${escapeHtml(decision.chapter)}<br>${escapeHtml(decision.date)}</span>
            <span class="history-log-choice">${escapeHtml(decision.choiceLabel)}</span>
          </div>`
        )
        .join("");
    }
    openLayer("historyModal");
  }

  /* ======================= 特稿 ======================= */

  function renderArticle(reading) {
    if (!reading) return;
    const body = [
      `<p class="article-kicker">${escapeHtml(C.ui.articleKicker)}</p>`,
      `<p class="reading-genre">${escapeHtml(reading.genre)}</p>`,
      `<h1 class="article-title">${escapeHtml(reading.title)}</h1>`,
      `<div class="article-meta"><span>${escapeHtml(reading.author)}</span><span>${escapeHtml(
        reading.source
      )}</span><span>${escapeHtml(reading.date)}</span></div>`,
      `<div class="reading-top-actions">
        <a class="btn btn-ink btn-small" href="${escapeHtml(
          reading.url
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(C.ui.readOriginal)} ↗</a>
      </div>`,
      `<div class="article-deck">
        <p class="reading-why-label">${escapeHtml(C.ui.whyRead)}</p>
        <p>${escapeHtml(reading.note)}</p>
      </div>`,
      `<section class="article-section reading-excerpt-section">
        <h2>${escapeHtml(C.ui.excerptLabel)}</h2>
        <blockquote class="article-excerpt">
          ${reading.excerpt.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        </blockquote>
      </section>`,
      `<div class="article-note"><p>${escapeHtml(C.ui.articleNote)}</p></div>`,
      `<div class="reading-source">
        <p><strong>${escapeHtml(C.ui.sourceLabel)}</strong>：${escapeHtml(reading.source)}，${escapeHtml(
        reading.date
      )}</p>
        <a class="btn btn-ink btn-small" href="${escapeHtml(
          reading.url
        )}" target="_blank" rel="noopener noreferrer">${escapeHtml(C.ui.readOriginal)}</a>
        <p>${escapeHtml(C.ui.externalHint)}</p>
      </div>`,
      `<p class="article-end">${escapeHtml(C.ui.articleEnd)}</p>`
    ];
    $("#articleBody").innerHTML = body.join("");
  }

  function openArticle() {
    const reading = C.readings && C.readings[state.endingId];
    if (!reading) {
      showToast("这篇延伸阅读尚未准备好。");
      return;
    }
    renderArticle(reading);
    openLayer("readingOverlay");
    $("#articleBody").scrollTop = 0;
  }

  /* ======================= 弹层 / 提示 ======================= */

  function lockBody(locked) {
    document.body.style.overflow = locked ? "hidden" : "";
  }

  function openLayer(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.hidden = false;
    openLayers.add(id);
    lockBody(true);
    const closeButton = element.querySelector(".icon-btn");
    window.setTimeout(() => closeButton && closeButton.focus(), 60);
  }

  function closeLayer(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.hidden = true;
    openLayers.delete(id);
    if (!openLayers.size) lockBody(false);
  }

  function closeTopLayer() {
    const ids = Array.from(openLayers);
    if (!ids.length) return;
    closeLayer(ids[ids.length - 1]);
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  /* ======================= 环境音 ======================= */

  function startAmbient() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      showToast(C.ui.soundUnsupported);
      return;
    }

    try {
      const context = new AudioContextClass();
      const master = context.createGain();
      master.gain.value = 0.0001;
      master.connect(context.destination);

      const oscA = context.createOscillator();
      const oscB = context.createOscillator();
      const oscGainA = context.createGain();
      const oscGainB = context.createGain();
      oscA.type = "sine";
      oscB.type = "sine";
      oscA.frequency.value = 110;
      oscB.frequency.value = 164.81;
      oscGainA.gain.value = 0.028;
      oscGainB.gain.value = 0.016;
      oscA.connect(oscGainA);
      oscB.connect(oscGainB);
      oscGainA.connect(master);
      oscGainB.connect(master);

      const bufferSize = context.sampleRate * 3;
      const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        data[i] = (Math.random() * 2 - 1) * 0.45;
      }
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const noiseFilter = context.createBiquadFilter();
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.value = 420;
      const noiseGain = context.createGain();
      noiseGain.gain.value = 0.018;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(master);

      oscA.start();
      oscB.start();
      noise.start();
      master.gain.exponentialRampToValueAtTime(0.75, context.currentTime + 2.4);

      let chimeTimer = null;
      const chime = () => {
        if (!audioEngine || audioEngine.context.state === "closed") return;
        const now = context.currentTime;
        const bell = context.createOscillator();
        const bellGain = context.createGain();
        bell.type = "sine";
        bell.frequency.value = Math.random() > 0.55 ? 523.25 : 392;
        bellGain.gain.setValueAtTime(0.0001, now);
        bellGain.gain.exponentialRampToValueAtTime(0.03, now + 0.04);
        bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);
        bell.connect(bellGain);
        bellGain.connect(master);
        bell.start(now);
        bell.stop(now + 4);
      };

      chimeTimer = window.setInterval(chime, 14500);
      window.setTimeout(chime, 4200);

      audioEngine = { context, master, oscA, oscB, noise, chimeTimer };
      soundOn = true;
      updateChrome();
    } catch (error) {
      showToast(C.ui.soundError);
    }
  }

  function stopAmbient() {
    if (!audioEngine) {
      soundOn = false;
      updateChrome();
      return;
    }
    const engine = audioEngine;
    audioEngine = null;
    soundOn = false;
    window.clearInterval(engine.chimeTimer);
    try {
      const now = engine.context.currentTime;
      engine.master.gain.cancelScheduledValues(now);
      engine.master.gain.setValueAtTime(engine.master.gain.value || 0.7, now);
      engine.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      window.setTimeout(() => {
        try {
          engine.oscA.stop();
          engine.oscB.stop();
          engine.noise.stop();
          engine.context.close();
        } catch (error) {
          /* 已关闭。 */
        }
      }, 700);
    } catch (error) {
      /* 已关闭。 */
    }
    updateChrome();
  }

  function toggleSound() {
    if (soundOn) {
      stopAmbient();
      showToast(C.ui.soundOffToast);
    } else {
      startAmbient();
      if (soundOn) showToast(C.ui.soundOnToast);
    }
  }

  /* ======================= 事件绑定 ======================= */

  function bindEvents() {
    $("#startBtn").addEventListener("click", () => {
      if (isInProgress()) {
        const confirmed = window.confirm(C.ui.confirmRestart);
        if (!confirmed) return;
      }
      if (state.ended) {
        replay();
      } else {
        startJourney();
      }
    });

    $("#resumeBtn").addEventListener("click", () => {
      if (state.screen === "ending" && state.ended) {
        renderEnding(state.endingId);
      } else if (state.phase === "prologue") {
        renderPrologue();
      } else if (state.phase === "branch") {
        renderBranch();
      } else if (state.phase === "echo") {
        renderScene();
      } else if (state.phase === "choice") {
        renderScene();
      } else {
        startJourney();
      }
    });

    $("#coverRestartBtn").addEventListener("click", () => {
      const confirmed = window.confirm(C.ui.confirmRestart);
      if (!confirmed) return;
      startJourney();
    });

    $("#brandBtn").addEventListener("click", () => {
      state.screen = "cover";
      saveState();
      renderCover();
    });

    $("#coverGalleryBtn").addEventListener("click", openGallery);
    $("#galleryBtn").addEventListener("click", openGallery);
    $("#endingGalleryBtn").addEventListener("click", openGallery);
    $("#coverAboutBtn").addEventListener("click", openAbout);
    $("#aboutBtn").addEventListener("click", openAbout);
    $("#soundBtn").addEventListener("click", toggleSound);

    $("#choiceList").addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (action && action.getAttribute("data-action") === "prologue-continue") {
        enterFirstScene();
        return;
      }
      if (action && action.getAttribute("data-action") === "branch-ending") {
        resolveBranchEnding();
        return;
      }
      const button = event.target.closest("[data-choice-id]");
      if (button) chooseOption(button.getAttribute("data-choice-id"));
    });

    $("#continueBtn").addEventListener("click", goNext);
    $("#readArticleBtn").addEventListener("click", openArticle);
    $("#historyBtn").addEventListener("click", openHistory);
    $("#replayBtn").addEventListener("click", replay);
    $("#endingHomeBtn").addEventListener("click", () => {
      state.screen = "cover";
      saveState();
      renderCover();
    });

    $("#saveNoteBtn").addEventListener("click", () => {
      const input = $("#playerNoteInput");
      const value = input.value.trim();
      if (!value) {
        showToast(C.ui.playerNoteEmpty);
        return;
      }
      state.note = value;
      saveState();
      $("#noteSaved").hidden = false;
      showToast(C.ui.playerNoteSaved);
    });

    $("#printArticleBtn").addEventListener("click", () => {
      window.print();
    });

    document.addEventListener("click", (event) => {
      const closer = event.target.closest("[data-close]");
      if (closer) {
        closeLayer(closer.getAttribute("data-close"));
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeTopLayer();
        return;
      }

      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (openLayers.size) return;

      if (state.screen === "game" && state.phase === "choice") {
        const key = Number(event.key);
        if (key >= 1 && key <= 4) {
          const buttons = $$("#choiceList [data-choice-id]");
          if (buttons[key - 1]) {
            event.preventDefault();
            buttons[key - 1].click();
          }
        }
      }

      if (event.key === "Enter" && state.screen === "game") {
        if (state.phase === "echo") {
          event.preventDefault();
          goNext();
        } else if (state.phase === "prologue") {
          event.preventDefault();
          enterFirstScene();
        } else if (state.phase === "branch") {
          event.preventDefault();
          resolveBranchEnding();
        }
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && soundOn) stopAmbient();
    });
  }

  /* ======================= SVG 场景插画 ======================= */

  function sceneArtSVG(key) {
    const art = {
      hangzhou: hangzhouArt(),
      jiande: jiandeArt(),
      jian: jianArt(),
      taihe: taiheArt(),
      yishan: yishanArt(),
      meitan: meitanArt(),
      return: returnArt()
    };
    return art[key] || hangzhouArt();
  }

  function starField(count, width, height, color) {
    let result = "";
    for (let i = 0; i < count; i += 1) {
      const x = (i * 137.5 + 41) % width;
      const y = (i * 83.7 + 29) % height;
      const r = i % 7 === 0 ? 2 : i % 3 === 0 ? 1.4 : 1;
      result += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}" opacity="${(0.25 + (i % 5) * 0.1).toFixed(2)}"/>`;
    }
    return result;
  }

  function hangzhouArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="夜色中的西湖与浙大校园">
      <defs>
        <linearGradient id="hz-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#091a22"/>
          <stop offset="55%" stop-color="#29444a"/>
          <stop offset="100%" stop-color="#a17d59"/>
        </linearGradient>
        <radialGradient id="hz-moon-glow">
          <stop offset="0%" stop-color="#f4ddb0" stop-opacity=".9"/>
          <stop offset="48%" stop-color="#e9c98d" stop-opacity=".22"/>
          <stop offset="100%" stop-color="#e9c98d" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="hz-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#243e40"/>
          <stop offset="100%" stop-color="#0b1718"/>
        </linearGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#hz-sky)"/>
      ${starField(42, 900, 580, "#f2e2bf")}
      <circle cx="655" cy="220" r="190" fill="url(#hz-moon-glow)"/>
      <circle cx="655" cy="220" r="66" fill="#f0d9a8" opacity=".92"/>
      <path d="M0 650 L120 585 L220 620 L340 540 L470 615 L590 555 L710 630 L830 560 L900 600 L900 780 L0 780 Z" fill="#182d2e" opacity=".8"/>
      <path d="M0 710 L140 650 L280 700 L410 620 L550 700 L690 640 L820 710 L900 680 L900 810 L0 810 Z" fill="#122525"/>
      <path d="M0 775 Q180 730 360 775 T720 770 T900 760 L900 1200 L0 1200 Z" fill="url(#hz-water)"/>
      <g opacity=".3" stroke="#d5bc8a" stroke-width="1">
        <path d="M560 830 Q660 805 760 830"/>
        <path d="M520 870 Q650 840 800 870"/>
        <path d="M600 910 Q690 890 780 910"/>
        <path d="M470 950 Q610 915 760 950"/>
      </g>
      <g fill="#0a1414">
        <path d="M0 860 Q130 760 260 860 L260 1200 L0 1200 Z"/>
        <path d="M640 880 Q740 800 900 850 L900 1200 L640 1200 Z"/>
      </g>
      <g fill="#0a1212">
        <path d="M110 880 l70 -55 l70 55 l-16 0 l-54 -40 l-54 40 z"/>
        <path d="M130 900 l50 -38 l50 38 z"/>
      </g>
      <g stroke="#b9945e" stroke-width="2" fill="none" opacity=".75">
        <path d="M300 860 Q450 800 600 860"/>
        <path d="M315 878 Q450 820 585 878"/>
      </g>
      <g fill="#0c1717">
        <path d="M360 866 q30 -28 60 0 l-5 30 l-50 0 z"/>
        <path d="M430 856 q24 -24 48 0 l-4 26 l-40 0 z"/>
        <path d="M500 868 q22 -22 44 0 l-3 24 l-38 0 z"/>
        <path d="M270 850 l8 -90 l8 90 z"/>
        <path d="M360 838 l8 -74 l8 74 z"/>
      </g>
      <g fill="#e0b970" opacity=".86">
        <rect x="346" y="900" width="8" height="11"/>
        <rect x="404" y="916" width="7" height="10"/>
        <rect x="510" y="906" width="8" height="11"/>
      </g>
      <g stroke="#1b2725" stroke-width="4" fill="none">
        <path d="M55 1200 Q85 960 40 780"/>
        <path d="M88 1200 Q112 980 96 820"/>
        <path d="M125 1200 Q150 990 168 860"/>
      </g>
      <g stroke="#263a34" stroke-width="2" fill="none" opacity=".8">
        <path d="M40 845 q26 70 10 140"/>
        <path d="M70 880 q16 56 0 118"/>
        <path d="M145 905 q10 50 -4 110"/>
      </g>
      <g fill="#c28e50" opacity=".8">
        <circle cx="360" cy="890" r="18" opacity=".18"/>
        <circle cx="360" cy="890" r="6"/>
        <circle cx="520" cy="898" r="15" opacity=".15"/>
        <circle cx="520" cy="898" r="5"/>
      </g>
    </svg>`;
  }

  function jiandeArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="雨夜江边的书箱与渡船">
      <defs>
        <linearGradient id="jd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#17282c"/>
          <stop offset="60%" stop-color="#435854"/>
          <stop offset="100%" stop-color="#8b8268"/>
        </linearGradient>
        <linearGradient id="jd-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#263f40"/>
          <stop offset="100%" stop-color="#0b1617"/>
        </linearGradient>
        <radialGradient id="jd-lamp">
          <stop offset="0%" stop-color="#f2c777" stop-opacity=".95"/>
          <stop offset="45%" stop-color="#d69d4d" stop-opacity=".3"/>
          <stop offset="100%" stop-color="#d69d4d" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#jd-sky)"/>
      <g opacity=".22" stroke="#d9ccb3" stroke-width="1">
        ${Array.from({ length: 38 }, (_, i) => {
          const x = (i * 97) % 940 - 20;
          const y = (i * 53) % 830;
          return `<path d="M${x} ${y} l-24 74"/>`;
        }).join("")}
      </g>
      <path d="M0 620 L140 510 L260 600 L390 485 L520 590 L660 520 L800 600 L900 560 L900 780 L0 780 Z" fill="#1b2d2d" opacity=".72"/>
      <path d="M0 700 L150 640 L280 700 L430 620 L570 710 L720 650 L900 710 L900 820 L0 820 Z" fill="#112221"/>
      <path d="M0 760 Q180 720 360 760 T720 755 T900 740 L900 1200 L0 1200 Z" fill="url(#jd-water)"/>
      <g opacity=".26" stroke="#d2b986" stroke-width="1">
        <path d="M70 900 Q240 860 420 900"/>
        <path d="M160 950 Q350 905 545 950"/>
        <path d="M370 1000 Q540 960 720 1000"/>
      </g>
      <g transform="translate(520 760)">
        <path d="M-150 120 Q0 180 180 112 L150 210 Q0 255 -120 206 Z" fill="#0a1414"/>
        <path d="M-120 116 L-96 -32 L18 -70 L130 8 L150 116 Z" fill="#132321"/>
        <path d="M-96 -32 L18 -70 L130 8 L-10 42 Z" fill="#243b37"/>
        <g fill="#584a36" stroke="#8b7351" stroke-width="2">
          <rect x="-58" y="58" width="62" height="48"/>
          <rect x="14" y="48" width="58" height="46"/>
          <rect x="72" y="84" width="48" height="38"/>
        </g>
        <path d="M72 -8 L118 18 L118 72" stroke="#89724f" stroke-width="3" fill="none"/>
        <circle cx="118" cy="72" r="12" fill="url(#jd-lamp)"/>
        <circle cx="118" cy="72" r="4" fill="#f4d18b"/>
      </g>
      <g fill="#0a1313">
        <path d="M0 980 Q150 920 310 980 L310 1200 L0 1200 Z"/>
        <path d="M600 1020 Q760 940 900 1000 L900 1200 L600 1200 Z"/>
      </g>
      <g fill="#101c1b">
        <path d="M58 910 l10 -130 l10 130 z"/>
        <path d="M214 880 l8 -110 l8 110 z"/>
        <path d="M700 940 l9 -120 l9 120 z"/>
      </g>
      <g fill="#c28b4c">
        <circle cx="118" cy="832" r="30" opacity=".12"/>
        <circle cx="118" cy="832" r="6"/>
      </g>
    </svg>`;
  }

  function jianArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="赣江白鹭洲上的书院与夜读灯火">
      <defs>
        <linearGradient id="ja-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#162b2d"/>
          <stop offset="55%" stop-color="#345450"/>
          <stop offset="100%" stop-color="#b08f61"/>
        </linearGradient>
        <linearGradient id="ja-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2d4a47"/>
          <stop offset="100%" stop-color="#0b1717"/>
        </linearGradient>
        <radialGradient id="ja-moon">
          <stop offset="0%" stop-color="#f4e1b7" stop-opacity=".85"/>
          <stop offset="50%" stop-color="#ecd8aa" stop-opacity=".16"/>
          <stop offset="100%" stop-color="#ecd8aa" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#ja-sky)"/>
      ${starField(28, 900, 500, "#f0e2c2")}
      <circle cx="220" cy="210" r="150" fill="url(#ja-moon)"/>
      <circle cx="220" cy="210" r="48" fill="#f1dfb6" opacity=".82"/>
      <path d="M0 620 L120 560 L250 620 L360 530 L500 610 L650 540 L780 615 L900 570 L900 760 L0 760 Z" fill="#1a2e2c" opacity=".75"/>
      <path d="M0 690 L130 640 L280 700 L430 620 L580 700 L730 650 L900 710 L900 800 L0 800 Z" fill="#102220"/>
      <path d="M0 760 Q200 720 400 760 T800 760 T900 750 L900 1200 L0 1200 Z" fill="url(#ja-water)"/>
      <g opacity=".23" stroke="#d4bc8d" stroke-width="1">
        <path d="M90 890 Q260 850 430 890"/>
        <path d="M230 940 Q410 900 600 940"/>
        <path d="M420 1000 Q600 960 780 1000"/>
      </g>
      <g fill="#0b1615">
        <path d="M135 855 Q300 700 510 795 Q610 842 720 850 L720 1020 L135 1020 Z" opacity=".9"/>
      </g>
      <g transform="translate(320 700)">
        <path d="M-110 90 L0 20 L130 86 L130 150 L-110 150 Z" fill="#141f1c"/>
        <path d="M-130 92 L0 4 L150 88 L130 98 L0 40 L-116 100 Z" fill="#0d1715"/>
        <path d="M-80 150 L-80 230 L92 230 L92 150" fill="#1b2924" stroke="#5f5139" stroke-width="2"/>
        <path d="M-20 150 L-20 230" stroke="#5f5139" stroke-width="2"/>
        <path d="M-8 156 L-8 218" stroke="#111d1a" stroke-width="18"/>
        <g fill="#d09d57">
          <rect x="-68" y="170" width="20" height="14" opacity=".82"/>
          <rect x="36" y="174" width="20" height="14" opacity=".7"/>
        </g>
        <path d="M0 20 L0 -52" stroke="#5f5139" stroke-width="3"/>
        <path d="M-18 -52 L18 -52" stroke="#5f5139" stroke-width="3"/>
      </g>
      <g fill="#0c1716">
        <path d="M0 1030 Q90 970 180 1010 L200 1200 L0 1200 Z"/>
        <path d="M700 1030 Q800 970 900 1000 L900 1200 L700 1200 Z"/>
      </g>
      <g stroke="#2b4038" stroke-width="3" fill="none">
        <path d="M45 1200 Q78 1030 68 920"/>
        <path d="M90 1200 Q110 1050 102 960"/>
        <path d="M136 1200 Q154 1080 150 1000"/>
      </g>
      <g fill="#c89a5c" opacity=".85">
        <circle cx="352" cy="880" r="14" opacity=".18"/>
        <circle cx="352" cy="880" r="4"/>
        <circle cx="438" cy="886" r="14" opacity=".18"/>
        <circle cx="438" cy="886" r="4"/>
      </g>
      <g stroke="#c9b189" stroke-width="1.5" fill="none" opacity=".55">
        <path d="M520 250 q16 -16 32 0 q16 -16 32 0"/>
        <path d="M600 210 q12 -12 24 0 q12 -12 24 0"/>
        <path d="M470 310 q10 -10 20 0 q10 -10 20 0"/>
      </g>
    </svg>`;
  }

  function taiheArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="泰和上田村的田野、堤坝与村庄">
      <defs>
        <linearGradient id="th-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4e5540"/>
          <stop offset="45%" stop-color="#a6875d"/>
          <stop offset="100%" stop-color="#dfb274"/>
        </linearGradient>
        <linearGradient id="th-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6b6b46"/>
          <stop offset="100%" stop-color="#353a28"/>
        </linearGradient>
        <radialGradient id="th-sun">
          <stop offset="0%" stop-color="#f3d49d" stop-opacity=".95"/>
          <stop offset="55%" stop-color="#e5b36e" stop-opacity=".24"/>
          <stop offset="100%" stop-color="#e5b36e" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#th-sky)"/>
      <circle cx="700" cy="300" r="210" fill="url(#th-sun)"/>
      <circle cx="700" cy="300" r="62" fill="#f0c985" opacity=".75"/>
      <path d="M0 640 L100 580 L210 640 L330 555 L450 630 L580 565 L710 640 L820 590 L900 630 L900 820 L0 820 Z" fill="#5c5c3f" opacity=".65"/>
      <path d="M0 730 L140 670 L280 730 L420 665 L560 735 L700 675 L840 735 L900 700 L900 1200 L0 1200 Z" fill="url(#th-field)"/>
      <g fill="none" stroke="#8e8655" stroke-width="2" opacity=".55">
        <path d="M0 810 Q220 760 450 810 T900 805"/>
        <path d="M0 870 Q230 820 460 870 T900 862"/>
        <path d="M0 940 Q240 885 480 940 T900 930"/>
        <path d="M0 1020 Q250 960 500 1020 T900 1010"/>
      </g>
      <path d="M70 840 Q250 780 440 840 T830 830" stroke="#b2a06f" stroke-width="16" fill="none" opacity=".55"/>
      <g transform="translate(0 0)">
        <path d="M520 760 l60 -45 l60 45 l-8 10 l-52 -35 l-52 35 z" fill="#23291d"/>
        <path d="M548 770 l32 -22 l32 22 l-32 32 z" fill="#2c3122"/>
        <path d="M560 800 l40 0 l0 50 l-40 0 z" fill="#1c2118"/>
        <path d="M300 790 l50 -36 l50 36 l-7 8 l-43 -28 l-43 28 z" fill="#252b1e"/>
        <path d="M320 798 l30 -20 l30 20 l-30 26 z" fill="#303421"/>
        <path d="M332 822 l36 0 l0 40 l-36 0 z" fill="#1b2017"/>
        <path d="M674 780 l45 -30 l45 30 l-6 8 l-39 -24 l-39 24 z" fill="#242a1e"/>
        <path d="M692 788 l27 -18 l27 18 l-27 24 z" fill="#303420"/>
        <path d="M702 810 l34 0 l0 38 l-34 0 z" fill="#1b2017"/>
      </g>
      <g fill="#1b1f15">
        <path d="M178 902 q13 -20 26 0 l-4 30 l-18 0 z"/>
        <path d="M238 912 q11 -18 22 0 l-3 27 l-16 0 z"/>
        <path d="M166 894 l32 -6" stroke="#1b1f15" stroke-width="3"/>
        <path d="M226 904 l30 -6" stroke="#1b1f15" stroke-width="3"/>
      </g>
      <g stroke="#20251a" stroke-width="2">
        <path d="M184 934 l-8 50"/>
        <path d="M196 934 l8 50"/>
        <path d="M322 885 l30 -12"/>
        <path d="M340 885 l-8 42"/>
      </g>
      <g fill="#c9a267" opacity=".75">
        <rect x="566" y="800" width="7" height="9"/>
        <rect x="338" y="820" width="7" height="9"/>
      </g>
    </svg>`;
  }

  function yishanArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="宜山夜雨中的山峦、警报与校舍">
      <defs>
        <linearGradient id="ys-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1c1919"/>
          <stop offset="50%" stop-color="#51332a"/>
          <stop offset="100%" stop-color="#b16136"/>
        </linearGradient>
        <linearGradient id="ys-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2b2823"/>
          <stop offset="100%" stop-color="#0c1010"/>
        </linearGradient>
        <radialGradient id="ys-fire">
          <stop offset="0%" stop-color="#f4b35f" stop-opacity=".85"/>
          <stop offset="48%" stop-color="#cc6131" stop-opacity=".28"/>
          <stop offset="100%" stop-color="#cc6131" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#ys-sky)"/>
      <g opacity=".35" stroke="#e3c18b" stroke-width="1">
        ${Array.from({ length: 28 }, (_, i) => {
          const x = (i * 123) % 930 - 20;
          const y = (i * 71) % 800;
          return `<path d="M${x} ${y} l-34 88"/>`;
        }).join("")}
      </g>
      <circle cx="720" cy="360" r="230" fill="url(#ys-fire)"/>
      <g fill="#0b1110" opacity=".9">
        <path d="M0 660 L76 470 L132 610 L200 400 L280 610 L355 500 L430 640 L520 430 L600 620 L680 490 L760 650 L840 520 L900 620 L900 900 L0 900 Z"/>
      </g>
      <g fill="#090e0d">
        <path d="M0 760 L120 690 L250 760 L380 700 L510 770 L650 710 L790 770 L900 735 L900 1200 L0 1200 Z"/>
      </g>
      <g stroke="#6e4b32" stroke-width="2" fill="#1b1a16" opacity=".9">
        <path d="M540 760 L540 680 L700 680 L700 760"/>
        <path d="M550 680 L620 620 L690 680"/>
        <path d="M566 764 L566 718 L590 718 L590 764"/>
        <path d="M640 764 L640 718 L666 718 L666 764"/>
      </g>
      <g fill="#d8964d">
        <rect x="574" y="726" width="9" height="10" opacity=".8"/>
        <rect x="648" y="726" width="9" height="10" opacity=".65"/>
      </g>
      <g transform="translate(480 260) rotate(-12)">
        <path d="M0 0 L90 18 L100 28 L24 26 L-20 10 Z" fill="#0b0f0e"/>
        <path d="M10 4 L34 -18 L48 -14 L34 16 Z" fill="#0b0f0e"/>
        <path d="M42 12 L60 -4 L72 0 L60 20 Z" fill="#0b0f0e"/>
      </g>
      <g stroke="#d6b87f" stroke-width="2" opacity=".28">
        <path d="M290 560 L110 260"/>
        <path d="M300 560 L620 180"/>
      </g>
      <g stroke="#2b2b22" stroke-width="4" fill="none">
        <path d="M0 1010 Q160 960 320 1000"/>
        <path d="M600 1010 Q750 950 900 990"/>
      </g>
      <g fill="#c98a4c" opacity=".9">
        <circle cx="540" cy="760" r="5"/>
        <circle cx="710" cy="756" r="4"/>
      </g>
    </svg>`;
  }

  function meitanArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="湄潭夜色中的文庙、茶山与桐油灯">
      <defs>
        <linearGradient id="mt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#101f21"/>
          <stop offset="58%" stop-color="#3d4b3e"/>
          <stop offset="100%" stop-color="#b28b5d"/>
        </linearGradient>
        <linearGradient id="mt-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#334b3b"/>
          <stop offset="100%" stop-color="#14231c"/>
        </linearGradient>
        <radialGradient id="mt-moon">
          <stop offset="0%" stop-color="#f5e1b3" stop-opacity=".9"/>
          <stop offset="48%" stop-color="#efd9a7" stop-opacity=".18"/>
          <stop offset="100%" stop-color="#efd9a7" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mt-lamp">
          <stop offset="0%" stop-color="#ffd78d" stop-opacity="1"/>
          <stop offset="42%" stop-color="#e8a951" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#e8a951" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#mt-sky)"/>
      ${starField(36, 900, 620, "#f0dfbb")}
      <circle cx="690" cy="210" r="210" fill="url(#mt-moon)"/>
      <circle cx="690" cy="210" r="55" fill="#f1dfb7" opacity=".86"/>
      <path d="M0 650 L120 570 L250 640 L390 550 L530 640 L680 570 L820 650 L900 610 L900 820 L0 820 Z" fill="#1d3127" opacity=".75"/>
      <path d="M0 740 Q160 650 320 720 T640 715 T900 700 L900 1200 L0 1200 Z" fill="url(#mt-hill)"/>
      <g fill="none" stroke="#78906b" stroke-width="2" opacity=".35">
        <path d="M0 830 Q230 780 450 830 T900 825"/>
        <path d="M0 900 Q230 850 450 900 T900 895"/>
        <path d="M0 970 Q230 915 450 970 T900 965"/>
        <path d="M0 1040 Q230 985 450 1040 T900 1035"/>
      </g>
      <g transform="translate(0 0)">
        <path d="M100 760 L280 660 L470 760 L470 830 L100 830 Z" fill="#1a211b"/>
        <path d="M80 768 L280 640 L490 768 L470 782 L280 684 L100 782 Z" fill="#0d1512"/>
        <path d="M126 830 L126 1030 L444 1030 L444 830" fill="#262a20"/>
        <path d="M260 830 L260 1030" stroke="#5d4c34" stroke-width="3"/>
        <path d="M126 830 L444 830" stroke="#5d4c34" stroke-width="3"/>
        <path d="M180 850 L180 940 L236 940 L236 850 Z" fill="#d5b06e" opacity=".7"/>
        <path d="M320 850 L320 940 L376 940 L376 850 Z" fill="#d5b06e" opacity=".55"/>
        <path d="M224 940 L224 1030 L344 1030 L344 940 Z" fill="#171d17"/>
      </g>
      <g>
        <path d="M270 710 L270 656" stroke="#2f2b20" stroke-width="2"/>
        <circle cx="270" cy="700" r="38" fill="url(#mt-lamp)"/>
        <circle cx="270" cy="700" r="7" fill="#ffd994"/>
        <path d="M310 720 L310 676" stroke="#2f2b20" stroke-width="2"/>
        <circle cx="310" cy="720" r="25" fill="url(#mt-lamp)" opacity=".7"/>
        <circle cx="310" cy="720" r="5" fill="#ffd994" opacity=".85"/>
      </g>
      <g fill="#0b1310">
        <path d="M0 1040 Q100 970 200 1020 L220 1200 L0 1200 Z"/>
        <path d="M700 1040 Q800 980 900 1010 L900 1200 L700 1200 Z"/>
      </g>
      <g stroke="#17251c" stroke-width="3" fill="none">
        <path d="M70 1200 Q100 1050 84 940"/>
        <path d="M120 1200 Q145 1080 140 980"/>
        <path d="M760 1200 Q786 1080 780 990"/>
      </g>
      <g fill="#e2bc7a" opacity=".8">
        <circle cx="270" cy="700" r="2"/>
        <circle cx="310" cy="720" r="2"/>
      </g>
    </svg>`;
  }

  function returnArt() {
    return `
    <svg viewBox="0 0 900 1200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="晨光中的湄江归舟与远山">
      <defs>
        <linearGradient id="rt-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1e3036"/>
          <stop offset="48%" stop-color="#7f7c65"/>
          <stop offset="100%" stop-color="#e0b272"/>
        </linearGradient>
        <linearGradient id="rt-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8d805f"/>
          <stop offset="100%" stop-color="#1d2c2b"/>
        </linearGradient>
        <radialGradient id="rt-sun">
          <stop offset="0%" stop-color="#fff0c8" stop-opacity=".95"/>
          <stop offset="38%" stop-color="#f8d28d" stop-opacity=".42"/>
          <stop offset="100%" stop-color="#f8d28d" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="1200" fill="url(#rt-sky)"/>
      <circle cx="680" cy="410" r="240" fill="url(#rt-sun)"/>
      <circle cx="680" cy="410" r="60" fill="#ffe8b2" opacity=".75"/>
      <g opacity=".3" stroke="#f4dda8" stroke-width="1">
        <path d="M0 520 Q240 480 480 520 T900 510"/>
        <path d="M0 560 Q240 520 480 560 T900 550"/>
      </g>
      <path d="M0 660 L110 590 L230 655 L350 570 L480 650 L610 585 L740 655 L850 605 L900 630 L900 800 L0 800 Z" fill="#455445" opacity=".65"/>
      <path d="M0 740 Q180 690 360 740 T720 735 T900 720 L900 1200 L0 1200 Z" fill="url(#rt-water)"/>
      <g opacity=".28" stroke="#f3dca7" stroke-width="2">
        <path d="M430 860 Q580 835 760 860"/>
        <path d="M380 920 Q570 885 790 920"/>
        <path d="M460 980 Q620 950 800 980"/>
        <path d="M340 1040 Q540 1000 760 1040"/>
      </g>
      <g transform="translate(470 760)">
        <path d="M-180 150 Q0 210 210 140 L180 246 Q0 300 -150 238 Z" fill="#0b1413"/>
        <path d="M-140 146 L-110 -20 L20 -60 L150 10 L178 146 Z" fill="#1d2d29"/>
        <path d="M-110 -20 L20 -60 L150 10 L-8 48 Z" fill="#354841"/>
        <g fill="#5d4a34" stroke="#967c54" stroke-width="2">
          <rect x="-70" y="76" width="70" height="54"/>
          <rect x="8" y="66" width="64" height="52"/>
          <rect x="78" y="94" width="52" height="42"/>
        </g>
        <path d="M80 -10 L132 22 L132 84" stroke="#967c54" stroke-width="3" fill="none"/>
        <circle cx="132" cy="84" r="16" fill="#f7cf87" opacity=".18"/>
        <circle cx="132" cy="84" r="5" fill="#f7cf87"/>
      </g>
      <g fill="#0c1513">
        <path d="M0 1080 Q120 1010 240 1060 L260 1200 L0 1200 Z"/>
        <path d="M700 1080 Q800 1020 900 1050 L900 1200 L700 1200 Z"/>
      </g>
      <g fill="#0c1513">
        <path d="M100 900 l12 -100 l12 100 z"/>
        <path d="M760 920 l10 -90 l10 90 z"/>
      </g>
      <g stroke="#1a2a27" stroke-width="2" fill="none" opacity=".62">
        <path d="M580 330 q18 -18 36 0 q18 -18 36 0"/>
        <path d="M650 300 q12 -12 24 0 q12 -12 24 0"/>
        <path d="M520 360 q10 -10 20 0 q10 -10 20 0"/>
      </g>
      <g fill="#f7d28d" opacity=".8">
        <circle cx="132" cy="844" r="4"/>
      </g>
    </svg>`;
  }

  function endingArtSVG(tone) {
    if (tone === "history") return historyWideArt();
    if (tone === "good") return goodWideArt();
    if (tone === "hidden") return lanternArt();
    return mistArt();
  }

  function historyWideArt() {
    return `
    <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="晨光中，浙大师生乘船东归杭州">
      <defs>
        <linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1b3035"/>
          <stop offset="48%" stop-color="#727560"/>
          <stop offset="100%" stop-color="#d9ae73"/>
        </linearGradient>
        <linearGradient id="hw-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#867c5e"/>
          <stop offset="100%" stop-color="#192927"/>
        </linearGradient>
        <radialGradient id="hw-sun">
          <stop offset="0%" stop-color="#fff1c9" stop-opacity=".96"/>
          <stop offset="38%" stop-color="#f7d18c" stop-opacity=".38"/>
          <stop offset="100%" stop-color="#f7d18c" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1440" height="800" fill="url(#hw-sky)"/>
      <circle cx="1080" cy="270" r="210" fill="url(#hw-sun)"/>
      <circle cx="1080" cy="270" r="48" fill="#ffe7b1" opacity=".8"/>
      <g opacity=".28" stroke="#f4dca7" stroke-width="1.4">
        <path d="M0 360 Q260 320 520 360 T1040 355 T1440 345"/>
        <path d="M0 400 Q260 360 520 400 T1040 395 T1440 385"/>
      </g>
      <path d="M0 480 L170 395 L330 470 L500 380 L680 470 L860 400 L1040 480 L1220 410 L1440 475 L1440 620 L0 620 Z" fill="#304137" opacity=".72"/>
      <path d="M0 545 Q260 495 520 545 T1040 540 T1440 520 L1440 800 L0 800 Z" fill="url(#hw-water)"/>
      <g opacity=".26" stroke="#f5dba4" stroke-width="2">
        <path d="M160 620 Q390 590 620 620"/>
        <path d="M530 680 Q780 645 1030 680"/>
        <path d="M260 735 Q540 700 820 735"/>
      </g>
      <g transform="translate(620 520)">
        <path d="M-210 118 Q0 160 240 108 L214 190 Q0 236 -184 178 Z" fill="#0a1514"/>
        <path d="M-170 112 L-140 -32 L0 -70 L170 8 L202 112 Z" fill="#1b2c28"/>
        <path d="M-140 -32 L0 -70 L170 8 L-6 46 Z" fill="#31453e"/>
        <g fill="#564631" stroke="#947b53" stroke-width="2">
          <rect x="-92" y="28" width="72" height="54"/>
          <rect x="-4" y="18" width="66" height="54"/>
          <rect x="80" y="42" width="58" height="46"/>
        </g>
        <path d="M96 -24 L150 8 L150 72" stroke="#947b53" stroke-width="3" fill="none"/>
        <circle cx="150" cy="72" r="10" fill="#f5cb82" opacity=".3"/>
        <circle cx="150" cy="72" r="3" fill="#ffe3a5"/>
        <path d="M-190 112 L-210 180" stroke="#0a1514" stroke-width="5"/>
        <path d="M212 108 L234 170" stroke="#0a1514" stroke-width="5"/>
      </g>
      <g fill="#0b1513">
        <path d="M0 690 Q160 635 330 690 L360 800 L0 800 Z"/>
        <path d="M1100 690 Q1260 630 1440 680 L1440 800 L1100 800 Z"/>
      </g>
      <g stroke="#1b2a25" stroke-width="3" fill="none">
        <path d="M180 800 Q205 700 192 640"/>
        <path d="M228 800 Q250 720 246 662"/>
        <path d="M1240 800 Q1266 710 1256 655"/>
      </g>
      <g fill="#0c1513">
        <path d="M300 560 l11 -76 l11 76 z"/>
        <path d="M1170 585 l9 -70 l9 70 z"/>
      </g>
      <g stroke="#1c2b27" stroke-width="2" fill="none" opacity=".65">
        <path d="M860 240 q18 -18 36 0 q18 -18 36 0"/>
        <path d="M930 205 q12 -12 24 0 q12 -12 24 0"/>
        <path d="M790 285 q10 -10 20 0 q10 -10 20 0"/>
      </g>
      <g fill="#f6d18a" opacity=".85">
        <circle cx="770" cy="592" r="3.5"/>
      </g>
    </svg>`;
  }

  function goodWideArt() {
    return `
    <svg viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="黔北茶山与村庄，一名教师在田间小路上走向学校">
      <defs>
        <linearGradient id="gw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4a5647"/>
          <stop offset="52%" stop-color="#a18a61"/>
          <stop offset="100%" stop-color="#e3bb7b"/>
        </linearGradient>
        <linearGradient id="gw-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#74815a"/>
          <stop offset="100%" stop-color="#38462f"/>
        </linearGradient>
        <radialGradient id="gw-sun">
          <stop offset="0%" stop-color="#fff0c8" stop-opacity=".92"/>
          <stop offset="50%" stop-color="#f4cf8d" stop-opacity=".25"/>
          <stop offset="100%" stop-color="#f4cf8d" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1440" height="800" fill="url(#gw-sky)"/>
      <circle cx="1110" cy="235" r="230" fill="url(#gw-sun)"/>
      <circle cx="1110" cy="235" r="54" fill="#f4d094" opacity=".7"/>
      <path d="M0 420 L160 340 L330 425 L510 335 L690 425 L860 355 L1050 435 L1230 365 L1440 425 L1440 620 L0 620 Z" fill="#526044" opacity=".62"/>
      <path d="M0 485 Q240 430 480 485 T960 480 T1440 460 L1440 800 L0 800 Z" fill="url(#gw-hill)"/>
      <g fill="none" stroke="#9aa26d" stroke-width="2" opacity=".45">
        <path d="M0 535 Q240 480 480 535 T960 530 T1440 510"/>
        <path d="M0 590 Q240 535 480 590 T960 585 T1440 565"/>
        <path d="M0 650 Q240 595 480 650 T960 645 T1440 625"/>
        <path d="M0 715 Q240 660 480 715 T960 710 T1440 690"/>
      </g>
      <g transform="translate(930 500)">
        <path d="M-120 50 L-25 5 L80 50 L80 105 L-120 105 Z" fill="#2b3022"/>
        <path d="M-142 52 L-25 -2 L100 52 L82 62 L-25 18 L-122 66 Z" fill="#171d15"/>
        <path d="M-90 105 L-90 160 L46 160 L46 105" fill="#343723" stroke="#6f5c3d" stroke-width="2"/>
        <path d="M-10 105 L-10 160" stroke="#6f5c3d" stroke-width="2"/>
        <rect x="-72" y="115" width="22" height="16" fill="#e0b56d" opacity=".72"/>
        <rect x="10" y="118" width="20" height="15" fill="#e0b56d" opacity=".6"/>
      </g>
      <path d="M380 800 Q520 690 720 660 Q880 635 1000 720" fill="none" stroke="#c4ad7a" stroke-width="18" opacity=".36"/>
      <g fill="#20251a">
        <path d="M610 610 q14 -20 28 0 l-4 38 l-20 0 z"/>
        <path d="M620 648 l-8 70" stroke="#20251a" stroke-width="4"/>
        <path d="M628 648 l10 70" stroke="#20251a" stroke-width="4"/>
        <path d="M618 590 l26 0 l0 22 l-26 0 z" fill="#1b2017"/>
        <path d="M618 612 l-10 26" stroke="#20251a" stroke-width="4"/>
        <path d="M644 612 l12 22" stroke="#20251a" stroke-width="4"/>
      </g>
      <g fill="#0d1712">
        <path d="M0 715 Q130 650 280 705 L300 800 L0 800 Z"/>
        <path d="M1160 710 Q1300 645 1440 690 L1440 800 L1160 800 Z"/>
      </g>
      <g stroke="#283a2a" stroke-width="3" fill="none">
        <path d="M140 800 Q160 710 150 655"/>
        <path d="M188 800 Q208 725 202 675"/>
        <path d="M1280 800 Q1304 720 1294 670"/>
      </g>
      <g fill="#e3bd7a" opacity=".8">
        <circle cx="1150" cy="520" r="3"/>
        <circle cx="1002" cy="535" r="2.5"/>
      </g>
    </svg>`;
  }

  function lanternArt() {
    return `
    <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="黑暗中的一盏桐油灯与一本打开的笔记">
      <defs>
        <radialGradient id="lt-glow">
          <stop offset="0%" stop-color="#ffe6ae" stop-opacity="1"/>
          <stop offset="34%" stop-color="#efbb68" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#efbb68" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="lt-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1412"/>
          <stop offset="60%" stop-color="#1a2721"/>
          <stop offset="100%" stop-color="#0b100f"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#lt-bg)"/>
      <circle cx="650" cy="390" r="340" fill="url(#lt-glow)"/>
      <g transform="translate(520 620)">
        <path d="M-210 20 Q0 -20 230 26 L210 120 Q0 72 -190 116 Z" fill="#d9c9a4"/>
        <path d="M-210 20 Q0 16 230 26 L220 52 Q0 34 -210 44 Z" fill="#f1e4c5"/>
        <path d="M-176 48 Q-80 38 10 48 L0 100 Q-90 90 -166 96 Z" fill="#e8d9b7" opacity=".82"/>
        <path d="M28 48 Q120 38 200 52 L190 106 Q110 96 18 100 Z" fill="#e8d9b7" opacity=".82"/>
        <g stroke="#9d7e4e" stroke-width="1.2" opacity=".55">
          <path d="M-154 62 L-24 62"/><path d="M-154 74 L-44 74"/><path d="M-154 86 L-60 86"/>
          <path d="M46 64 L172 64"/><path d="M46 76 L164 76"/><path d="M46 88 L138 88"/>
        </g>
      </g>
      <g transform="translate(650 330)">
        <path d="M-54 116 L54 116 L42 154 L-42 154 Z" fill="#5f4a2f"/>
        <path d="M-34 116 L34 116 L24 78 L-24 78 Z" fill="#2b2a21"/>
        <path d="M-46 78 L46 78 L38 62 L-38 62 Z" fill="#7d603a"/>
        <path d="M-23 62 L23 62 L16 34 L-16 34 Z" fill="#b38045" opacity=".9"/>
        <ellipse cx="0" cy="74" rx="15" ry="9" fill="#ffd58a"/>
        <path d="M0 92 C-16 74 -20 62 -10 54 C-2 48 4 58 0 72 C4 54 12 46 20 52 C30 60 22 80 0 92Z" fill="#ffe6aa"/>
        <circle cx="0" cy="72" r="7" fill="#fff0c4"/>
      </g>
      <g fill="#ecce91" opacity=".7">
        <circle cx="520" cy="270" r="2"/>
        <circle cx="760" cy="250" r="2"/>
        <circle cx="820" cy="340" r="1.5"/>
        <circle cx="470" cy="380" r="1.5"/>
      </g>
    </svg>`;
  }

  function mistArt() {
    return `
    <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="雾气笼罩的远山与江面">
      <defs>
        <linearGradient id="ms-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1a2524"/>
          <stop offset="55%" stop-color="#3d4a43"/>
          <stop offset="100%" stop-color="#7c745f"/>
        </linearGradient>
        <linearGradient id="ms-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3d4a43"/>
          <stop offset="100%" stop-color="#101918"/>
        </linearGradient>
        <radialGradient id="ms-mist">
          <stop offset="0%" stop-color="#c8c2ab" stop-opacity=".38"/>
          <stop offset="100%" stop-color="#c8c2ab" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="800" fill="url(#ms-sky)"/>
      <circle cx="830" cy="180" r="56" fill="#d7c7a2" opacity=".35"/>
      <path d="M0 430 L140 340 L270 430 L400 330 L540 440 L680 360 L820 450 L960 370 L1100 440 L1200 400 L1200 600 L0 600 Z" fill="#1a2824" opacity=".7"/>
      <path d="M0 510 Q220 460 440 510 T880 505 T1200 490 L1200 800 L0 800 Z" fill="url(#ms-water)"/>
      <ellipse cx="650" cy="520" rx="500" ry="120" fill="url(#ms-mist)"/>
      <g opacity=".2" stroke="#d1c4a5" stroke-width="1">
        <path d="M100 620 Q320 580 540 620"/><path d="M380 680 Q600 640 820 680"/><path d="M560 730 Q760 700 960 730"/>
      </g>
      <g fill="#0c1412" opacity=".7">
        <path d="M0 760 Q160 700 320 750 L340 800 L0 800 Z"/>
        <path d="M840 750 Q1000 690 1200 740 L1200 800 L840 800 Z"/>
      </g>
    </svg>`;
  }

  /* ======================= 初始化 ======================= */

  function init() {
    bindStaticCopy();
    renderAbout();
    bindEvents();
    updateChrome();
    renderCover();
  }

  init();
})();
