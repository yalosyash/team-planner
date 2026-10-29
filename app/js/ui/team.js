/* ============================================================
   ui/team.js — название команды в шапке (чип, правится по клику).
   ============================================================ */
import { $, esc } from "../core/dom.js";
import { state, save } from "../core/storage.js";

const DEFAULT_TITLE = "Планировщик загрузки команды";

function render(force) {
  const wrap = $("#teamWrap");
  if (!wrap) return;
  // не сбиваем ввод, если пользователь как раз правит название
  if (!force && wrap.querySelector("#teamInput")) return;
  const name = String(state.team || "").trim();
  wrap.innerHTML = `<button type="button" class="team-chip${name ? "" : " is-empty"}"
    id="teamBtn" title="${name ? "Изменить название команды" : "Указать, чья это команда"}"
  >${name ? esc(name) : "Название команды"}</button>`;
  $("#teamBtn").addEventListener("click", edit);
  document.title = name ? "Планировщик загрузки — " + name : DEFAULT_TITLE;
}

function edit() {
  const wrap = $("#teamWrap");
  if (!wrap) return;
  wrap.innerHTML = `<input class="team-input" id="teamInput" maxlength="40"
    placeholder="Например, Тестирование" value="${esc(state.team || "")}">`;
  const input = $("#teamInput");
  input.focus();
  input.select();

  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      state.team = input.value.trim();
      save();
    }
    render(true);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

export const renderTeam = render;
