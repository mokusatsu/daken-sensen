"use strict";

const GameKeys = (() => {
  const controls = 'a[href], a[aria-keyshortcuts], button, input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
  const textField = 'input:not([type]), input[type="text"], input[type="search"], textarea, [contenteditable="true"]';
  const directions = new Map([["j", 1], ["k", -1], ["a", -1], ["d", 1], ["h", -1], ["l", 1]]);
  let pendingField;

  function markClose(dialog) {
    const close = dialog.querySelector('.player-close, form[method="dialog"] button');
    if (close && !close.hasAttribute("aria-keyshortcuts")) close.setAttribute("aria-keyshortcuts", "F");
  }

  function visible(el) {
    return el && !el.closest("[hidden], [inert]") &&
      (el.matches("summary") || !el.closest("details:not([open])")) &&
      el.getClientRects().length > 0 && getComputedStyle(el).visibility === "visible";
  }

  function enabled(el) {
    return !el.matches(':disabled, a:not([href])') && !el.closest('[aria-disabled="true"]');
  }

  function clearField() {
    pendingField?.removeAttribute("data-key-field");
    pendingField = null;
  }

  function select(el) {
    if (!el) return;
    el.focus();
    if (el.matches(textField)) {
      pendingField = el;
      el.setAttribute("data-key-field", "");
    }
  }

  function adjust(el, step) {
    const old = el.value;
    if (el.matches("select")) {
      const options = Array.from(el.options);
      let index = el.selectedIndex + step;
      while (options[index]?.matches(":disabled")) index += step;
      if (options[index]) el.selectedIndex = index;
    } else if (el.matches('input[type="range"]')) {
      if (step > 0) el.stepUp(); else el.stepDown();
    } else if (el.hasAttribute("data-key-arrows")) {
      el.dispatchEvent(new KeyboardEvent("keydown", {key: step > 0 ? "ArrowRight" : "ArrowLeft", bubbles: true, cancelable: true}));
      return true;
    } else return false;
    if (el.value !== old) {
      el.dispatchEvent(new Event("input", {bubbles: true}));
      el.dispatchEvent(new Event("change", {bubbles: true}));
    }
    return true;
  }

  document.addEventListener("focusin", clearField);
  document.addEventListener("compositionstart", clearField);
  document.addEventListener("pointerdown", () => {
    clearField();
    document.documentElement.classList.remove("home-keys");
  }, true);

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ||
        event.isComposing || event.keyCode === 229) return;
    const key = event.key.toLowerCase();
    const active = document.activeElement;
    if (active?.matches(textField) && active !== pendingField) {
      if (key !== "enter" || active.matches("textarea, [contenteditable]")) return;
      event.preventDefault();
      if (!event.repeat) {
        document.documentElement.classList.add("home-keys");
        if (active.form?.matches(".player-form") && !active.hasAttribute("aria-invalid")) active.form.requestSubmit();
        else select(active);
      }
      return;
    }
    const step = directions.get(key);
    if (!step && !["s", "f", "g", ";", " ", "enter"].includes(key)) {
      if (pendingField && (key.length === 1 || key === "backspace" || key === "delete")) clearField();
      return;
    }
    const dialog = active?.closest("dialog[open]") ?? Array.from(document.querySelectorAll("dialog[open]")).at(-1);
    const pause = document.getElementById("pause");
    if (!dialog && document.body.hasAttribute("data-key-typing")) {
      if (key === " ") {
        event.preventDefault();
        if (!event.repeat && visible(pause) && enabled(pause)) {
          document.documentElement.classList.add("home-keys");
          pause.click();
          select(pause);
        }
      }
      return;
    }
    const scope = dialog ?? document;
    const shown = Array.from(scope.querySelectorAll(controls)).filter(el => !el.hasAttribute("data-letter") && visible(el));
    const items = shown.filter(enabled);
    if (!items.length) return;
    const first = items.find(el => el.closest("[data-key-start]")) ?? items[0];
    const index = items.indexOf(active);
    const target = index < 0 ? first : active;
    document.documentElement.classList.add("home-keys");
    event.preventDefault();
    if (step && key !== "j" && key !== "k" && adjust(target, step)) {
      if (index < 0) select(target);
      return;
    }
    const shortcut = key.length === 1 && key !== " " && shown.find(el => el.getAttribute("aria-keyshortcuts")?.toLowerCase() === key);
    if (shortcut) {
      if (enabled(shortcut) && (!event.repeat || shortcut.hasAttribute("data-stage-step"))) {
        shortcut.focus({preventScroll: true});
        shortcut.click();
      }
      return;
    }
    if (step) {
      select(index < 0 ? first : items[(index + step + items.length) % items.length]);
      return;
    }
    if (event.repeat) return;
    if (key === "f") {
      if (dialog) {
        if (dialog.dispatchEvent(new Event("cancel", {cancelable: true}))) dialog.close();
      } else if (pause?.getAttribute("aria-pressed") === "true" && visible(pause) && enabled(pause)) {
        pause.click();
      } else {
        const back = items.find(el => el.hasAttribute("data-key-back"));
        back?.click();
      }
    } else if (key !== " " && key !== "enter") {
      return;
    } else if (target.matches(textField)) {
      target.focus();
      clearField();
    } else if (target.hasAttribute("data-key-submit")) {
      const action = document.getElementById(target.dataset.keySubmit);
      if (visible(action) && enabled(action)) action.click();
    } else if (target.matches("select, input[type=range]") || target.hasAttribute("data-key-arrows")) {
      select(items[(items.indexOf(target) + 1) % items.length]);
    } else {
      target.click();
    }
  }, true);

  for (const dialog of document.querySelectorAll("dialog")) markClose(dialog);
  return {addGuide: markClose};
})();
