/* ============================================================
   ui/tooltip.js — подсказка на карточках доски.

   Системный title показывается браузером с большой задержкой, не
   переносит строки одинаково во всех браузерах и не попадает в тему.
   Поэтому рисуем свою плашку в стиле проекта (поверхность + рамка из
   переменных --tip-*): в светлой теме она светлая, в тёмной — тёмная.
   Появляется по задержке, не выходит за край экрана и не перехватывает
   клик.

   Текст берётся из data-tip: это либо JSON с полями карточки (board.js
   ставит его только там, где содержимое действительно обрезано), либо
   простая строка — так подписаны значки статуса. Для статуса системный
   title не используем: иначе рядом с плашкой проекта появлялся бы чужой
   тултип браузера.
   ============================================================ */
import { onRender } from "../core/render.js";
import { esc } from "../core/dom.js";
import { taskLabels } from "../core/task-labels.js";

const DELAY = 400; // мс; столько же просил заказчик в TODO
const GAP = 8; // отступ плашки от карточки
const PAD = 8; // отступ от края окна

let tip = null;
let timer = null;
let current = null;

/* плашка одна на всё приложение */
function ensureTip() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

/* Текст подсказки: JSON из data-hint (см. board.js) или простая строка
   (подпись значка статуса). JSON собираем в разметку, чтобы номер,
   описание и длительность читались раздельно.
   Возвращаем и признак «только пилюля»: для статуса плашка-подложка не
   нужна, пилюля сама читается на доске. */
function tipHTML(raw) {
  let hint;
  try {
    hint = JSON.parse(raw);
  } catch (e) {
    // простая строка — короткая подпись, показываем голым текстом
    return { html: `<div class="tip-txt">${esc(raw)}</div>`, bare: true };
  }
  if (typeof hint !== "object" || hint === null) {
    return { html: `<div class="tip-txt">${esc(raw)}</div>`, bare: true };
  }
  const rows = [];
  const labels = taskLabels(hint)
    .map((label) => `<span class="tip-label">${label}</span> `)
    .join("");
  // шапка (номер + дни) есть только у подсказки карточки; у значка
  // статуса в data-tip лежит один статус — плашка будет из одной пилюли
  if (hint.head)
    rows.push(
      `<div class="tip-head"><span class="tip-num">${labels}${esc(hint.head)}</span>` +
        `<span class="tip-dur">${esc(hint.dur)}</span></div>`,
    );
  if (hint.title) rows.push(`<div class="tip-txt">${esc(hint.title)}</div>`);
  if (hint.status) rows.push(statusPill(hint));
  if (hint.link)
    rows.push(`<div class="tip-meta">Ссылка: ${esc(hint.link)}</div>`);
  if (hint.cut) rows.push(`<div class="tip-cut">${esc(hint.cut)}</div>`);
  return { html: rows.join(""), bare: !hint.head && !hint.title };
}

/* Статус — пилюлей, как индикатор хранения в шапке (.store): точка
   цвета статуса плюс подпись, скруглённые края и мягкая заливка.
   Текст статуса не «кричит», поэтому пилюля мелкая и вторичная.
   Ключ статуса (waiting/preprod) приходит из board.js; старые данные
   без него показываем простой строкой. */
function statusPill(hint) {
  const kind = hint.statusKind;
  if (kind !== "waiting" && kind !== "preprod")
    return `<div class="tip-meta">${esc(hint.status)}</div>`;
  return `<div class="tip-pill is-${kind}"><span class="tdot"></span>${esc(hint.status)}</div>`;
}

export function hideTip() {
  clearTimeout(timer);
  timer = null;
  current = null;
  if (tip) tip.classList.remove("show");
}

/* Поставить плашку рядом с карточкой: справа, если помещается, иначе
   слева. По вертикали — у верхнего края карточки, там же, где значок
   статуса: подсказка появляется «на месте» статуса, а не по центру
   блока. Если подпись висит на маленьком элементе внутри карточки
   (значок статуса), цепляемся к самой карточке — к её верхнему краю. */
function place(target) {
  const el = ensureTip();
  const text = target.dataset.tip;
  if (!text) return;

  // содержимое меняет размер — измеряем до показа, иначе плашка на кадр
  // мелькнёт в левом верхнем углу (opacity: 0 размеру не мешает)
  const content = tipHTML(text);
  el.innerHTML = content.html;
  // у подсказки из одной пилюли нет подложки: пилюля сама цветная плашка
  el.classList.toggle("is-bare", content.bare);
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  const box = (target.closest(".card") || target).getBoundingClientRect();

  let left = box.right + GAP;
  if (left + w > window.innerWidth - PAD) left = box.left - w - GAP;
  if (left < PAD) {
    // карточка занимает почти весь экран — держим плашку в границах окна
    left = Math.max(PAD, Math.min(window.innerWidth - w - PAD, box.left + GAP));
  }

  // верхний край карточки (там же, где значок статуса), без выхода за окно
  let top = box.top;
  top = Math.max(PAD, Math.min(window.innerHeight - h - PAD, top));

  el.style.left = left + "px";
  el.style.top = top + "px";
  el.classList.add("show");
}

/* наведение на карточку с подсказкой */
function onOver(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest("[data-tip]");
  if (!card) return;
  if (card === current) return; // двигаемся внутри той же карточки
  hideTip();
  current = card;
  timer = setTimeout(() => {
    if (current === card && card.isConnected) place(card);
  }, DELAY);
}

/* уход с карточки; переход между её же частями (номер → описание) не считаем */
function onOut(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const card = target.closest("[data-tip]");
  if (!card) return;
  const to = event.relatedTarget;
  if (to instanceof Element && card.contains(to)) return;
  if (current === card) hideTip();
}

export function initTooltip() {
  document.addEventListener("mouseover", onOver);
  document.addEventListener("mouseout", onOut);
  // прокрутка доски, уход из окна и клик (открытие задачи, модалка)
  // должны убирать плашку, иначе она «залипнет» на месте
  document.addEventListener("scroll", hideTip, true);
  document.addEventListener("mousedown", hideTip, true);
  window.addEventListener("blur", hideTip);
  document.addEventListener("mouseleave", hideTip);
  // при перерисовке доски старая карточка исчезает вместе со ссылкой
  // на неё — прячем плашку, чтобы не осталась висеть
  onRender(hideTip);
}
