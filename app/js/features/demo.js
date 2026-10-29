/* ============================================================
   features/demo.js — демонстрационные данные.
   ============================================================ */
import { toast } from "../core/dom.js";
import { addDays, addWorkdays, todayISO } from "../core/dates.js";
import { PALETTE, uid } from "../core/util.js";
import { state, save } from "../core/storage.js";
import { render } from "../core/render.js";

const NAMES = [
  "Женя",
  "Никита",
  "Даниил",
  "Влад",
  "Женя",
  "Юра",
  "Захар",
  "Оля",
];

/* задача: смещение от начала релиза в рабочих днях, длительность, номер */
const DEMO_TASKS = [
  [0, 0, 2, "9523", "Логику создания снэпшота при публикации"],
  [0, 3, 4, "10725", "Переход на общее окно для WS-V3"],
  [1, 0, 3, "9712", "Фильтрация и сортировка в корзине"],
  [1, 3, 1, "10021", "Инструмент управления настройками"],
  [1, 6, 1.5, "10652", "Адаптивная вёрстка"],
  [2, 0, 1, "9882", "Дополнить блок технических данных"],
  [2, 4, 3, "10071", "Контекстный доступ к ширифтам"],
  [3, 0, 5, "", "", "vacation"],
  [4, 0, 5, "9218", "Перенести элементы на следующую строку"],
  [4, 5, 1, "9675", "Проверка выхода за края"],
  [4, 6, 1.5, "10173", "Переход на единый редактор"],
  [5, 0, 4, "9381", "Доработать определение навигации ширифтов"],
  [5, 4, 3, "9382", "Доработать определение навигации ширифтов"],
  [6, 0, 2.5, "9870", "Поиск команды на вкладке Команды в ЛК"],
  [6, 5, 3, "", "", "vacation"],
  [7, 0, 1, "10957", "Починить русский сеансовый PROD"],
  [7, 0, 1, "10158", "Включить сеансовый PROD"],
  [7, 2, 5, "10170", "Оптимизация взаимодействия с vectorNetwork"],
];

export function loadDemo() {
  const start = todayISO();

  state.people = NAMES.map((name, index) => ({
    id: uid(),
    name,
    color: PALETTE[index % PALETTE.length],
  }));

  const release = {
    id: uid(),
    number: "3.14",
    start,
    end: addDays(start, 9),
  };
  state.releases = [release];
  state.activeId = release.id;

  state.tasks = DEMO_TASKS.map(
    ([personIndex, offset, days, number, title, type]) => ({
      id: uid(),
      releaseId: release.id,
      personId: state.people[personIndex].id,
      start: addWorkdays(start, offset),
      days,
      type: type || "task",
      number: number || undefined,
      title,
      // демо-данные уже в новой модели: дни рабочих задач — рабочие,
      // отпуск и больничный — календарные
      weekend: type === "vacation" || type === "sick",
      daysMode: "work",
    }),
  );

  save();
  render();
  toast("Демо-данные загружены");
}
