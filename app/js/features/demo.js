/* ============================================================
   features/demo.js — демонстрационные данные.

   Демо собрано под очередь (п.1+2): у каждого человека задачи идут
   подряд от начала релиза, параллельных дорожек нет. Отпуска стоят
   на своих датах и занимают дни. У Оли задач больше, чем дней в
   релизе, — видно переполнение и бейдж «за релизом».
   ============================================================ */
import { toast } from "../core/dom.js";
import { addDays, addWorkdays, todayISO } from "../core/dates.js";
import { PALETTE, normalizeLink, uid } from "../core/util.js";
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

/* задачи по людям: порядок в списке — это порядок очереди.
   offset нужен только отпуску/больничному: они не встают в очередь. */
const DEMO_TASKS = [
  {
    person: 0,
    days: 2,
    number: "9523",
    title: "Логику создания снэпшота при публикации",
    status: "preprod",
  },
  {
    person: 0,
    days: 4,
    number: "10725",
    title: "Переход на общее окно для WS-V3",
    link: "jira.company.ru/browse/1234",
  },

  {
    person: 1,
    days: 3,
    number: "9712",
    title: "Фильтрация и сортировка в корзине",
    status: "waiting",
  },
  {
    person: 1,
    days: 1,
    number: "10021",
    title: "Инструмент управления настройками",
  },
  // две полуторки подряд: вторая начинается в тот же день, где у первой
  // осталась половина — проверка стыкования внутри дня
  { person: 1, days: 1.5, number: "10652", title: "Адаптивная вёрстка" },
  {
    person: 1,
    days: 1.5,
    number: "10173",
    title: "Переход на единый редактор",
  },

  {
    person: 2,
    days: 1,
    number: "9882",
    title: "Дополнить блок технических данных",
  },
  {
    person: 2,
    days: 3,
    number: "10071",
    title: "Контекстный доступ к ширифтам",
  },

  // Влад: отпуск начинается внутри задачи — она «повисает» через него,
  // дни отпуска внутри блока заштрихованы (Р2)
  {
    person: 3,
    days: 6,
    number: "9381",
    title: "Доработать определение навигации ширифтов",
    status: "waiting",
  },
  { person: 3, days: 2, type: "vacation", offset: 2 },
  {
    person: 3,
    days: 2,
    number: "9382",
    title: "Доработать определение навигации ширифтов",
  },

  {
    person: 4,
    days: 5,
    number: "9218",
    title: "Перенести элементы на следующую строку",
  },
  { person: 4, days: 1, number: "9675", title: "Проверка выхода за края" },
  {
    person: 4,
    days: 1.5,
    number: "10173",
    title: "Переход на единый редактор",
  },

  {
    person: 5,
    days: 4,
    number: "9382",
    title: "Доработать определение навигации ширифтов",
  },
  {
    person: 5,
    days: 3,
    number: "9870",
    title: "Поиск команды на вкладке Команды в ЛК",
  },

  {
    person: 6,
    days: 2,
    number: "9871",
    title: "Поиск команды на вкладке Команды в ЛК",
  },
  { person: 6, days: 3, type: "vacation", offset: 2 },
  { person: 6, days: 2, number: "10653", title: "Адаптивная вёрстка карточек" },

  {
    person: 7,
    days: 1,
    number: "10957",
    title: "Починить русский сеансовый PROD",
  },
  { person: 7, days: 1, number: "10158", title: "Включить сеансовый PROD" },
  {
    person: 7,
    days: 5,
    number: "10170",
    title: "Оптимизация взаимодействия с vectorNetwork",
    status: "preprod",
  },
  {
    person: 7,
    days: 8,
    number: "11002",
    title: "Миграция справочников на новую схему",
  },
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
    end: addDays(start, 18),
  };
  state.releases = [release];
  state.activeId = release.id;

  state.tasks = DEMO_TASKS.map((item) => {
    const calendar = item.type === "vacation" || item.type === "sick";
    return {
      id: uid(),
      releaseId: release.id,
      personId: state.people[item.person].id,
      // у задачи дату всё равно пересчитает очередь; у отпуска она своя
      start: calendar ? addWorkdays(start, item.offset || 0) : start,
      days: item.days,
      type: item.type || "task",
      number: item.number || "",
      title: item.title || "",
      // У отсутствий нет статуса и ссылки.
      status: calendar ? "" : item.status || "",
      link: calendar ? "" : normalizeLink(item.link) || "",
      // демо-данные уже в новой модели: дни рабочих задач — рабочие,
      // отпуск и больничный — календарные
      weekend: calendar,
      daysMode: "work",
      labels: [],
    };
  });

  save();
  render();
  toast("Демо-данные загружены");
}
