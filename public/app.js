(() => {
  // A prompt box is a textarea the person can edit; other copy sources are plain text.
  const sourceText = (source) => ("value" in source ? source.value : source.textContent);

  // Copy buttons
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const source = document.querySelector(btn.dataset.copy);
    if (!source) return;
    try {
      await navigator.clipboard.writeText(sourceText(source));
      const label = btn.innerHTML;
      btn.textContent = "COPIED";
      setTimeout(() => {
        btn.innerHTML = label;
        btn.closest("details[data-menu]")?.removeAttribute("open");
      }, 1500);
    } catch {
      if ("select" in source) source.select();
      else getSelection().selectAllChildren(source);
    }
  });

  // A card's copy button also tells the log the link was copied, so agents stop offering that card.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-card-copied]");
    if (!btn || btn.dataset.sent) return;
    btn.dataset.sent = "1";
    const body = new FormData();
    body.set("op", "card_copied");
    body.set("id", btn.dataset.cardCopied);
    fetch("/owner/action", { method: "POST", body, headers: { Accept: "application/json" } }).catch(() => delete btn.dataset.sent);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dismiss]");
    if (!btn) return;
    const t = btn.closest("[data-toast]");
    if (t) hideToast(t);
    else btn.closest(".notice")?.remove();
  });

  // Toasts confirm a save, then leave after a few seconds. Hover or focus holds one in place, so it can be read.
  // ?done= is dropped from the address so a reload doesn't say it again.
  const TOAST_MS = 4500;
  const hideToast = (t) => {
    clearTimeout(t._timer);
    t.dataset.leaving = "";
    setTimeout(() => t.remove(), 250);
  };
  const armToast = (t) => {
    const arm = () => (t._timer = setTimeout(() => hideToast(t), TOAST_MS));
    const hold = () => clearTimeout(t._timer);
    t.addEventListener("pointerenter", hold);
    t.addEventListener("pointerleave", arm);
    t.addEventListener("focusin", hold);
    t.addEventListener("focusout", arm);
    arm();
  };
  document.querySelectorAll("[data-toast]").forEach((t) => {
    document.body.append(t);
    armToast(t);
  });
  const doneParams = new URLSearchParams(location.search);
  if (doneParams.has("done")) {
    doneParams.delete("done");
    const q = doneParams.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
  }

  // App links read the prompt box when clicked, so the agent gets the edited text.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-app-href]");
    if (!a) return;
    const source = document.querySelector(a.closest("[data-prompt-source]")?.dataset.promptSource || null);
    if (source) a.href = a.dataset.appHref.replace("{q}", encodeURIComponent(sourceText(source)));
  });

  // Forms that change who can see the log ask first.
  document.addEventListener("submit", (e) => {
    const msg = e.target.dataset?.confirm;
    if (msg && !confirm(msg)) e.preventDefault();
  });

  // Inside a dialog, a menu is fixed to the viewport so the dialog's scroll box doesn't clip it.
  // It opens up as marked (.up), unless there's no room above.
  document.addEventListener(
    "toggle",
    (e) => {
      const menu = e.target;
      if (!menu.matches?.("details[data-menu]") || !menu.open || !menu.closest("dialog")) return;
      const list = menu.querySelector(".menu-list");
      if (!list) return;
      const r = menu.querySelector("summary").getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const up = menu.classList.contains("up") && r.top - list.offsetHeight - 6 >= 8;
      Object.assign(list.style, {
        position: "fixed",
        right: `${vw - r.right}px`,
        top: up ? "auto" : `${r.bottom + 6}px`,
        bottom: up ? `${vh - r.top + 6}px` : "auto",
      });
    },
    true
  );

  // Prompt menus close on a click outside, once an app opens, and on Escape.
  const closeMenus = (except) =>
    document.querySelectorAll("details[data-menu][open]").forEach((m) => m !== except && m.removeAttribute("open"));
  document.addEventListener("click", (e) => {
    const menu = e.target.closest("details[data-menu]");
    closeMenus(menu);
    if (menu && e.target.closest("a.menu-item")) menu.removeAttribute("open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !document.querySelector("details[data-menu][open]")) return;
    e.preventDefault();
    closeMenus();
  });

  // A modal dialog sits in the browser's top layer, where element pickers in dev tools can't reach it.
  // Local dev opens dialogs non-modal instead; .modal:not(:modal) in app.css draws their backdrop.
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const openDialog = (d) => (local ? d.show() : d.showModal());
  if (local) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) document.querySelectorAll("dialog.modal[open], dialog.drawer[open]").forEach((d) => d.close());
    });
    // The box-shadow backdrop takes no clicks, so a press outside closes the dialog and its click never reaches the page.
    let swallowClick = false;
    document.addEventListener(
      "pointerdown",
      (e) => {
        const outside = [...document.querySelectorAll("dialog.modal[open], dialog.drawer[open]")].filter((d) => !d.contains(e.target));
        outside.forEach((d) => d.close());
        swallowClick = outside.length > 0;
      },
      true
    );
    document.addEventListener(
      "click",
      (e) => {
        if (!swallowClick) return;
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );
  }

  // Plain dialogs close on CANCEL, on the backdrop, and once an app opens.
  document.addEventListener("click", (e) => {
    const d = e.target.closest("dialog[data-dialog]");
    if (d && (e.target === d || e.target.closest("[data-dialog-close], a.menu-item"))) d.close();
  });

  // Fix with AI: one dialog, filled with the prompt of the row whose button opened it.
  const fixDialog = document.querySelector("[data-fix-dialog]");
  if (fixDialog && typeof fixDialog.showModal === "function") {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-fix]");
      if (!btn) return;
      fixDialog.querySelector("[data-fix-target]").textContent = btn.dataset.target;
      fixDialog.querySelector("#fix-prompt").value = btn.dataset.fix;
      openDialog(fixDialog);
    });
  }

  // Rule break: a proposed loop that can't be approved explains which rule its text breaks.
  const ruleDialog = document.querySelector("[data-rule-dialog]");
  if (ruleDialog && typeof ruleDialog.showModal === "function") {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rule-break]");
      if (!btn) return;
      ruleDialog.querySelector("[data-rule-code]").textContent = btn.dataset.code;
      ruleDialog.querySelector("[data-rule-name]").textContent = btn.dataset.name;
      // FIX closes this dialog (data-dialog-close) and, through data-fix, opens the fix dialog.
      const fix = ruleDialog.querySelector("[data-rule-fix]");
      if (fix) {
        fix.dataset.fix = btn.dataset.fixPrompt || "";
        fix.dataset.target = btn.dataset.code;
        fix.setAttribute("aria-label", `Fix ${btn.dataset.code} with AI`);
      }
      ruleDialog.querySelector("[data-rule-list]").replaceChildren(
        ...JSON.parse(btn.dataset.ruleBreak || "[]").map((m) => {
          const li = document.createElement("li");
          li.textContent = m;
          return li;
        })
      );
      openDialog(ruleDialog);
    });
  }

  // Export confirmation: explains the file before the download starts.
  const exportDialog = document.querySelector("[data-export-dialog]");
  if (exportDialog && typeof exportDialog.showModal === "function") {
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-export-open]")) return;
      e.preventDefault();
      openDialog(exportDialog);
    });
    exportDialog.querySelector("[data-export-cancel]").addEventListener("click", () => exportDialog.close());
    exportDialog.querySelector("form").addEventListener("submit", () => setTimeout(() => exportDialog.close()));
    exportDialog.addEventListener("click", (e) => {
      if (e.target === exportDialog) exportDialog.close();
    });
  }

  // Approve confirmation: each loop's button opens it; the checkbox widens it to every eligible loop.
  const dialog = document.querySelector("[data-approve-dialog]");
  if (dialog && typeof dialog.showModal === "function") {
    let all = JSON.parse(dialog.dataset.codes || "[]");
    const q = (sel) => dialog.querySelector(sel);
    const inputs = q("[data-codes-inputs]");
    const allBox = q("[data-approve-all]");
    const card = dialog.closest(".card");
    const icon = card.querySelector("[data-open-icon]");
    let one = null;

    // An approved row keeps its place, with a link to its loop page instead of the approve button.
    const markApproved = (code, i) => {
      const form = [...card.querySelectorAll("[data-approve-one]")].find((f) => f.elements.codes.value === code);
      if (!form) return;
      const row = form.closest("li");
      row.style.setProperty("--k", i);
      row.dataset.approved = "";
      const a = document.createElement("a");
      a.className = "icon-btn";
      a.href = `/loop/${encodeURIComponent(code)}`;
      a.title = `Open ${code}`;
      a.setAttribute("aria-label", `Open ${code}`);
      a.append(icon.content.cloneNode(true));
      const flag = document.createElement("span");
      flag.className = "flag-ok";
      flag.textContent = "APPROVED";
      form.previousElementSibling.querySelector("b").after(" ", flag);
      form.replaceWith(a);
    };

    q("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const codes = [...inputs.querySelectorAll("input")].map((i) => i.value);
      const submit = q("[data-approve-submit]");
      submit.disabled = true;
      try {
        const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
        const r = await res.json();
        if (!r.ok) {
          location.href = `/?error=${encodeURIComponent(r.error || "The loop wasn't approved.")}`;
          return;
        }
        let k = 0;
        codes.forEach((c) => {
          const row = card.querySelector(`[data-approve-one] input[value="${CSS.escape(c)}"]`)?.closest("li");
          markApproved(c, row && !row.hidden ? k++ : 0);
        });
        all = all.filter((c) => !codes.includes(c));
        dialog.close();
      } catch {
        form.submit();
      } finally {
        submit.disabled = false;
      }
    });

    const render = () => {
      const codes = allBox.checked ? all : [one.code];
      inputs.replaceChildren(
        ...codes.map((c) => {
          const i = document.createElement("input");
          i.type = "hidden";
          i.name = "codes";
          i.value = c;
          return i;
        })
      );
      q("[data-approve-title]").textContent = allBox.checked ? `Approve all ${all.length} loops?` : "Approve this loop?";
      q("[data-approve-code]").textContent = one.code;
      q("[data-approve-name]").textContent = one.name;
      q("[data-approve-loop]").hidden = allBox.checked;
      const rep = q("[data-approve-replaces]");
      rep.textContent = one.replaces ? `It replaces ${one.replaces}, which ${one.replaces.includes(",") ? "are" : "is"} retired at the same time.` : "";
      rep.hidden = allBox.checked || !one.replaces;
      q("[data-approve-submit]").textContent = allBox.checked ? `APPROVE ALL ${all.length}` : "APPROVE";
      q("[data-approve-all-label]").textContent = `Approve all ${all.length} proposed loops that pass the rules`;
    };

    document.addEventListener("submit", (e) => {
      const form = e.target.closest("[data-approve-one]");
      if (!form) return;
      e.preventDefault();
      const b = form.querySelector("[data-code]");
      one = { code: b.dataset.code, name: b.dataset.name, replaces: b.dataset.replaces };
      allBox.checked = false;
      allBox.parentElement.hidden = all.length < 2;
      render();
      openDialog(dialog);
    });
    allBox.addEventListener("change", render);
    q("[data-approve-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  // Branch tabs: one branch is always shown. Company first, or the first branch with rows.
  document.querySelectorAll("[data-branch-filter]").forEach((card) => {
    const bar = card.querySelector(".tabs");
    if (!bar) return;
    const tabs = [...bar.querySelectorAll("[data-branch-tab]")];
    const rows = [...card.querySelectorAll("[data-branch]")];
    const select = (branch) => {
      tabs.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.branchTab === branch)));
      rows.forEach((r) => (r.hidden = r.dataset.branch !== branch));
    };
    tabs.forEach((t) => t.addEventListener("click", () => select(t.dataset.branchTab)));
    const enabled = tabs.filter((t) => !t.disabled);
    const first = enabled.find((t) => t.dataset.branchTab === "C") || enabled[0];
    if (first) select(first.dataset.branchTab);
    bar.hidden = false;
  });

  // The small grid in the readout opens and closes the full one.
  const gridToggle = document.querySelector("[data-grid-toggle]");
  const fullGrid = document.getElementById("activity");
  if (gridToggle && fullGrid) {
    const setOpen = (open) => {
      fullGrid.toggleAttribute("data-open", open);
      gridToggle.setAttribute("aria-expanded", String(open));
      // Without the hash, :target in app.css stops holding it open.
      if (!open && location.hash === "#activity") history.replaceState(null, "", location.pathname + location.search);
    };
    setOpen(location.hash === "#activity");
    gridToggle.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(!fullGrid.hasAttribute("data-open"));
    });
    gridToggle.addEventListener("keydown", (e) => {
      if (e.key !== " ") return;
      e.preventDefault();
      gridToggle.click();
    });
  }

  // Loop page: the current level opens into every level, higher ones above and lower ones below.
  const stack = document.querySelector("[data-level-stack]");
  if (stack) {
    const now = stack.querySelector(".lvl-now");
    const hover = matchMedia("(hover: hover)");
    let closeTimer;
    const setOpen = (open) => {
      clearTimeout(closeTimer);
      stack.toggleAttribute("data-open", open);
      now.setAttribute("aria-expanded", String(open));
    };
    stack.addEventListener("mouseenter", () => hover.matches && setOpen(true));
    stack.addEventListener("mouseleave", () => {
      if (hover.matches) closeTimer = setTimeout(() => setOpen(false), 120);
    });
    now.addEventListener("click", () => setOpen(!stack.hasAttribute("data-open")));
    document.addEventListener("click", (e) => !stack.contains(e.target) && setOpen(false));
    document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  }

  // SHOW ALL: unfolds the rest of a list in place.
  document.querySelectorAll("[data-expand]").forEach((btn) => {
    const box = document.getElementById(btn.dataset.expand);
    if (!box) return;
    btn.addEventListener("click", () => {
      const on = !box.hasAttribute("data-expanded");
      box.toggleAttribute("data-expanded", on);
      btn.setAttribute("aria-expanded", String(on));
      btn.textContent = on ? btn.dataset.less : btn.dataset.more;
    });
  });

  // The experiments box opens the side panel.
  const drawer = document.getElementById("exp-drawer");
  if (drawer && typeof drawer.showModal === "function") {
    document.querySelector("[data-drawer-open]")?.addEventListener("click", () => openDialog(drawer));
  }

  // NEXT ACTIONS: each item opens one dialog, filled with that item's prompt.
  const askDialog = document.querySelector("[data-loop-prompt-dialog]");
  if (askDialog && typeof askDialog.showModal === "function") {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-loop-prompt]");
      if (!btn) return;
      btn.closest("details[data-menu]")?.removeAttribute("open");
      askDialog.querySelector("[data-prompt-title]").textContent = btn.dataset.title;
      askDialog.querySelector("#loop-prompt").value = btn.dataset.loopPrompt;
      openDialog(askDialog);
    });
  }

  // ADD NEW LOOP: the prompt keeps the person's edits between openings.
  const addDialog = document.querySelector("[data-add-loop-dialog]");
  if (addDialog && typeof addDialog.showModal === "function") {
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-add-loop]")) return;
      openDialog(addDialog);
      addDialog.querySelector("#add-loop-prompt").focus();
    });
  }

  // A button that names its dialog: the profile editor. The prompt keeps the person's edits between openings.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-open-dialog]");
    const d = btn && document.querySelector(btn.dataset.openDialog);
    if (!d || typeof d.showModal !== "function") return;
    openDialog(d);
    d.querySelector('textarea, input:not([type="hidden"])')?.focus();
  });

  // Header edits (about line, links): saved without leaving the page, so text that breaks a rule keeps everything typed.
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-quick-form]");
    if (!form) return;
    e.preventDefault();
    const error = form.querySelector("[data-form-error]");
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
      const r = await res.json();
      if (r.ok) {
        location.href = `/?done=${encodeURIComponent(r.done || "Saved.")}`;
        return;
      }
      error.textContent = r.error || "This wasn't saved.";
    } catch {
      error.textContent = "This wasn't saved. Check your connection and try again.";
    }
    error.hidden = false;
    submit.disabled = false;
  });

  // Activity: each day's bar explains itself on hover, or on tap on touch screens.
  // The bars rise once, in a wave from the oldest day, the first time the chart is on screen.
  const spark = document.querySelector("[data-spark]");
  if (spark) {
    const sparkTip = document.createElement("div");
    sparkTip.className = "tip";
    sparkTip.setAttribute("role", "tooltip");
    document.body.append(sparkTip);
    let hot = null;
    const hideSpark = () => {
      if (hot) delete hot.dataset.hot;
      hot = null;
      delete sparkTip.dataset.on;
    };
    const showSpark = (day) => {
      if (!day) return hideSpark();
      if (day === hot) return;
      if (hot) delete hot.dataset.hot;
      hot = day;
      day.dataset.hot = "";
      const lines = [
        ["", day.dataset.date],
        ["tip-name", day.dataset.n],
        ["tip-flag", day.dataset.ag],
      ];
      sparkTip.replaceChildren(
        ...lines
          .filter((l) => l[1])
          .map(([cls, text]) => {
            const s = document.createElement("span");
            s.className = cls;
            s.textContent = text;
            return s;
          })
      );
      sparkTip.dataset.on = "";
      const r = day.getBoundingClientRect();
      const w = sparkTip.offsetWidth;
      const h = sparkTip.offsetHeight;
      sparkTip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
      sparkTip.style.top = (r.top - h - 10 < 8 ? r.bottom + 10 : r.top - h - 10) + "px";
    };
    spark.addEventListener("pointerover", (e) => e.pointerType === "mouse" && showSpark(e.target.closest("li")));
    spark.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && hideSpark());
    spark.addEventListener("click", (e) => {
      e.stopPropagation();
      showSpark(e.target.closest("li"));
    });
    document.addEventListener("click", hideSpark);
    addEventListener("scroll", hideSpark, { passive: true });
    document.addEventListener("keydown", (e) => e.key === "Escape" && hideSpark());

    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
      spark.dataset.wait = "";
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io.disconnect();
          delete spark.dataset.wait;
          spark.dataset.play = "";
        },
        { threshold: 0.4 }
      );
      io.observe(spark);
    }
  }

  const grid = document.querySelector("[data-grid]");
  if (!grid) return;

  // ?moved= comes from an agent's link: the loops its last write moved. Marked once, then dropped from the
  // address so a reload or a shared copy doesn't keep pointing at them.
  const params = new URLSearchParams(location.search);
  const moved = new Set((params.get("moved") || "").split(",").filter(Boolean));
  if (params.has("moved")) {
    params.delete("moved");
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : "") + location.hash);
  }
  let marked = 0;
  grid.querySelectorAll(".cell[data-loop]").forEach((el) => {
    if (!moved.has(el.dataset.loop)) return;
    el.dataset.justMoved = "";
    marked++;
  });

  // Each cell's row and column across the whole grid. The build drains from the top left; isolation flips in a
  // wave that starts at the legend's side.
  const boxes = [...grid.querySelectorAll(".cells")];
  const colsOf = (box) => Number(box.style.getPropertyValue("--cols")) || 1;
  const totalCols = boxes.reduce((t, box) => t + colsOf(box), 0);
  const maxRows = Math.max(0, ...boxes.map((box) => Math.ceil(box.children.length / colsOf(box))));
  const cellPos = new Map();
  let colOffset = 0;
  boxes.forEach((box) => {
    const cols = colsOf(box);
    [...box.children].forEach((c, i) => cellPos.set(c, { r: Math.floor(i / cols), c: colOffset + (i % cols) }));
    colOffset += cols;
  });
  const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches && !!Element.prototype.animate;
  const legendList = document.querySelector(".legend");
  const legendBelow = () => legendList && legendList.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom - 1;

  // Build: the first time the grid is on screen it runs like a split-flap board. Blank flaps climb to solid green,
  // the board holds on 100 of 100, then drains in a wave from the top left, each square flipping down the ladder
  // to its real state and slowing as it falls. The flaps exist only while they turn.
  // The figure counts along: it shows the points of the cards facing up, then lands on the server's value.
  // "measured" is a flap face only: a measured Still yours square shows filled.
  const UP = ["still", "measured", "assisted", "delegated", "autonomous"];
  const DOWN = ["autonomous", "delegated", "assisted", "measured", "still", "empty"];
  const faceOf = (el) => (el.dataset.s === "still" && "measured" in el.dataset ? "measured" : el.dataset.s);
  const CLIMB_FLIP = 70;
  const DRAIN_FLIPS = [100, 125, 150, 175, 200];
  const HOLD_UNTIL = 1000;
  const figure = document.querySelector(".readout .pct");
  const finalFigure = figure?.textContent;
  const POINTS = { autonomous: 1, delegated: 1, assisted: Number(figure?.dataset.assistedWeight) || 0 };
  let live = 0;
  let shown = 0;
  let raf = 0;
  const tick = () => {
    const gap = live - shown;
    shown = Math.abs(gap) < 0.05 ? live : shown + gap * 0.14;
    figure.textContent = String(Math.round(shown * 10) / 10);
    raf = shown === live ? 0 : requestAnimationFrame(tick);
  };
  const countTo = (n) => {
    live = n;
    if (figure && !raf) raf = requestAnimationFrame(tick);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const half = (cls, face) => {
    const b = document.createElement("b");
    b.className = cls;
    b.dataset.s = face;
    return b;
  };
  const mount = (el, face) => {
    const sf = document.createElement("span");
    sf.className = "sf";
    const parts = { top: half("top", face), bot: half("bot", face), ft: half("top flap", face), fb: half("bot flap", face) };
    sf.append(parts.top, parts.bot, parts.ft, parts.fb);
    el.dataset.flipping = "";
    el.append(sf);
    return { el, sf, parts, face };
  };
  const unmount = (cell) => {
    cell.sf.remove();
    delete cell.el.dataset.flipping;
  };
  const flip = async (cell, to, duration, count = false) => {
    const p = cell.parts;
    p.top.dataset.s = to;
    p.bot.dataset.s = cell.face;
    p.ft.dataset.s = cell.face;
    p.fb.dataset.s = to;
    p.ft.style.visibility = "visible";
    const fall = p.ft.animate([{ transform: "rotateX(0deg)" }, { transform: "rotateX(-90deg)" }], { duration: duration * 0.5, easing: "cubic-bezier(0.55, 0, 1, 0.45)", fill: "forwards" });
    await fall.finished;
    p.ft.style.visibility = "hidden";
    fall.cancel();
    if (count) countTo(live + (POINTS[to] || 0) - (POINTS[cell.face] || 0));
    cell.face = to;
    p.fb.style.visibility = "visible";
    const land = p.fb.animate(
      [{ transform: "rotateX(90deg)" }, { transform: "rotateX(-8deg)", offset: 0.75 }, { transform: "rotateX(0deg)" }],
      { duration: duration * 0.62, easing: "cubic-bezier(0.2, 0, 0.4, 1)", fill: "forwards" }
    );
    await land.finished;
    p.bot.dataset.s = to;
    p.fb.style.visibility = "hidden";
    land.cancel();
  };
  const buildCell = async (el, start) => {
    const cell = mount(el, "blank");
    const { r = 0, c = 0 } = cellPos.get(el) || {};
    await sleep(Math.random() * 150);
    for (const s of UP) await flip(cell, s, CLIMB_FLIP, true);
    await sleep(start + HOLD_UNTIL - performance.now() + (r + c) * 22 + Math.random() * 160);
    const end = DOWN.indexOf(faceOf(el));
    for (let i = 1; i <= end; i++) await flip(cell, DOWN[i], DRAIN_FLIPS[i - 1], true);
    unmount(cell);
  };
  let building = false;
  // The build would cover the marked squares with flaps for its first seconds, so it sits this visit out.
  if (motion && !marked && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        if (figure) figure.textContent = "0";
        building = true;
        Promise.all([...grid.querySelectorAll(".cell")].map((el) => buildCell(el, start))).then(() => {
          building = false;
          if (!figure) return;
          countTo(Number(finalFigure) || 0);
          // Slow frames can leave the roll short of the end; the server's value always gets the last word.
          setTimeout(() => {
            cancelAnimationFrame(raf);
            raf = 0;
            shown = live;
            figure.textContent = finalFigure;
          }, 1000);
        });
      },
      { threshold: 0.2 }
    );
    io.observe(grid);
  }

  // Area focus
  const areaButtons = [...grid.querySelectorAll("[data-area-btn]")];
  areaButtons.forEach((b) =>
    b.addEventListener("click", () => {
      const on = grid.dataset.areaFocus === b.dataset.areaBtn;
      if (on) delete grid.dataset.areaFocus;
      else grid.dataset.areaFocus = b.dataset.areaBtn;
      areaButtons.forEach((x) => x.setAttribute("aria-pressed", String(!on && x === b)));
    })
  );

  // Legend hover: dims every cell at another level, and each area label shows how many it has at that level.
  // Every square flips to the middle of the ladder and back to its real face, in a wave from the legend's side.
  // A newer level takes over mid-wave: a flip already turning finishes, then the square heads for the new target.
  // Click locks a level until clicked again.
  const LEGEND_MID = "assisted";
  const LEGEND_FLIP = 80;
  const gridCells = [...grid.querySelectorAll(".cell")];
  const levelCounts = {};
  gridCells.forEach((el) => (levelCounts[el.dataset.s] = (levelCounts[el.dataset.s] || 0) + 1));
  const areaCounts = [...grid.querySelectorAll(".area")].map((area) => {
    const n = document.createElement("span");
    n.className = "n";
    n.hidden = true;
    area.querySelector(".area-label")?.append(n);
    return { n, cells: [...area.querySelectorAll(".cell")] };
  });
  const jobs = new Map();
  const turning = new Set();
  const setOff = (el, off) => {
    if (off) el.dataset.off = off;
    else delete el.dataset.off;
  };
  const turn = async (el) => {
    if (turning.has(el)) return;
    turning.add(el);
    let cell = null;
    while (jobs.has(el)) {
      const job = jobs.get(el);
      await sleep(job.at - performance.now());
      if (jobs.get(el) !== job) continue;
      setOff(el, job.off);
      if (building) {
        jobs.delete(el);
        break;
      }
      cell ||= mount(el, faceOf(el));
      el.dataset.turning = "";
      for (const s of [LEGEND_MID, faceOf(el)]) {
        if (jobs.get(el) !== job) break;
        if (cell.face !== s) await flip(cell, s, LEGEND_FLIP);
      }
      if (jobs.get(el) === job) {
        jobs.delete(el);
        delete el.dataset.turning;
      }
    }
    if (cell) unmount(cell);
    turning.delete(el);
  };

  const levelItems = [...document.querySelectorAll(".legend [data-level]")];
  let lockedLevel = null;
  let shownLevel = null;
  let dwell = 0;
  const focusLevel = (level) => {
    clearTimeout(dwell);
    if (level === shownLevel) return;
    shownLevel = level;
    areaCounts.forEach(({ n, cells }) => {
      n.hidden = !level;
      n.textContent = level ? cells.filter((el) => el.dataset.s === level).length : "";
    });
    const dim = levelCounts[level] ? "dim" : "soft";
    const below = legendBelow();
    const now = performance.now();
    gridCells.forEach((el) => {
      const off = level && el.dataset.s !== level ? dim : "";
      if (!motion) return setOff(el, off);
      const { r = 0, c = 0 } = cellPos.get(el) || {};
      const wave = below ? (maxRows - 1 - r) * 10 : (totalCols - 1 - c) * 14;
      jobs.set(el, { off, at: now + wave + Math.random() * 40 });
      turn(el);
    });
  };
  // Sweeping the pointer down the legend shouldn't start a wave for every item it crosses.
  const previewLevel = (level) => {
    clearTimeout(dwell);
    dwell = setTimeout(() => focusLevel(level), 60);
  };
  const toggleLock = (li) => {
    lockedLevel = lockedLevel === li.dataset.level ? null : li.dataset.level;
    levelItems.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.level === lockedLevel)));
    focusLevel(lockedLevel || li.dataset.level);
  };
  levelItems.forEach((li) => {
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-pressed", "false");
    li.addEventListener("mouseenter", () => previewLevel(li.dataset.level));
    li.addEventListener("mouseleave", () => previewLevel(lockedLevel));
    li.addEventListener("click", () => toggleLock(li));
    li.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleLock(li);
    });
  });

  // Loop tooltip: hover with a mouse, tap on touch screens.
  const labels = JSON.parse(grid.dataset.tip || "{}");
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let tipCell = null;

  const hideTip = () => {
    tipCell = null;
    delete tip.dataset.on;
  };

  const showTip = (cell, touch = false) => {
    if (!cell || !cell.dataset.loop) return hideTip();
    if (cell === tipCell) return;
    tipCell = cell;
    const d = cell.dataset;
    const lines = [
      ["tip-code", d.loop],
      ["tip-name", d.name],
      ["", labels.levels && labels.levels[d.s] + ("measured" in d && labels.measured ? ` · ${labels.measured}` : "")],
      ["tip-flag", labels.flags && labels.flags[d.flag]],
      ["failed" in d ? "tip-failed" : "", labels.outcomes && labels.outcomes[d.o]],
      ["tip-flag", touch && labels.open],
    ];
    tip.replaceChildren(
      ...lines
        .filter((l) => l[1])
        .map(([cls, text]) => {
          const s = document.createElement("span");
          s.className = cls;
          s.textContent = text;
          return s;
        })
    );
    tip.dataset.on = "";
    const r = cell.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
    tip.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + "px";
  };

  // A click opens the loop's page. On touch the first tap shows the tooltip and the second opens it.
  let pointer = "mouse";
  grid.addEventListener("pointerdown", (e) => (pointer = e.pointerType));
  grid.addEventListener("pointerover", (e) => {
    if (e.pointerType === "mouse") showTip(e.target.closest(".cell"));
  });
  grid.addEventListener("pointerleave", hideTip);
  grid.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell[data-loop]");
    if (!cell) return;
    e.stopPropagation();
    if (pointer === "mouse" || cell === tipCell) location.href = `/loop/${encodeURIComponent(cell.dataset.loop)}`;
    else showTip(cell, true);
  });
  document.addEventListener("click", hideTip);
  addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
})();
