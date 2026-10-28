/* ============================================================
   demo.js — демонстрационные данные
   ============================================================ */
/* ============ демо ============ */
function loadDemo() {
  const st = todayISO();
  const names = [
    "Женя",
    "Никита",
    "Даниил",
    "Влад",
    "Женя",
    "Юра",
    "Захар",
    "Оля",
  ];
  state.people = names.map((n, i) => ({
    id: uid(),
    name: n,
    color: PALETTE[i % PALETTE.length],
  }));
  const rel = {
    id: uid(),
    number: "3.14",
    start: st,
    end: addDays(st, 9),
  };
  state.releases = [rel];
  state.activeId = rel.id;
  const P = state.people;
  state.tasks = [
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[0].id,
      start: addWorkdays(st, 0),
      days: 2,
      type: "task",
      number: "9523",
      title: "Логику создания снэпшота при публикации",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[0].id,
      start: addWorkdays(st, 3),
      days: 4,
      type: "task",
      number: "10725",
      title: "Переход на общее окно для WS-V3",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addWorkdays(st, 0),
      days: 3,
      type: "task",
      number: "9712",
      title: "Фильтрация и сортировка в корзине",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addWorkdays(st, 3),
      days: 1,
      type: "task",
      number: "10021",
      title: "Инструмент управления настройками",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[1].id,
      start: addWorkdays(st, 6),
      days: 1.5,
      type: "task",
      number: "10652",
      title: "Адаптивная вёрстка",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[2].id,
      start: addWorkdays(st, 0),
      days: 1,
      type: "task",
      number: "9882",
      title: "Дополнить блок технических данных",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[2].id,
      start: addWorkdays(st, 4),
      days: 3,
      type: "task",
      number: "10071",
      title: "Контекстный доступ к ширифтам",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[3].id,
      start: addWorkdays(st, 0),
      days: 5,
      type: "vacation",
      title: "",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addWorkdays(st, 0),
      days: 5,
      type: "task",
      number: "9218",
      title: "Перенести элементы на следующую строку",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addWorkdays(st, 5),
      days: 1,
      type: "task",
      number: "9675",
      title: "Проверка выхода за края",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[4].id,
      start: addWorkdays(st, 6),
      days: 1.5,
      type: "task",
      number: "10173",
      title: "Переход на единый редактор",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[5].id,
      start: addWorkdays(st, 0),
      days: 4,
      type: "task",
      number: "9381",
      title: "Доработать определение навигации ширифтов",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[5].id,
      start: addWorkdays(st, 4),
      days: 3,
      type: "task",
      number: "9382",
      title: "Доработать определение навигации ширифтов",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[6].id,
      start: addWorkdays(st, 0),
      days: 2.5,
      type: "task",
      number: "9870",
      title: "Поиск команды на вкладке Команды в ЛК",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[6].id,
      start: addWorkdays(st, 5),
      days: 3,
      type: "vacation",
      title: "",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addWorkdays(st, 0),
      days: 1,
      type: "task",
      number: "10957",
      title: "Починить русский сеансовый PROD",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addWorkdays(st, 0),
      days: 1,
      type: "task",
      number: "10158",
      title: "Включить сеансовый PROD",
    },
    {
      id: uid(),
      releaseId: rel.id,
      personId: P[7].id,
      start: addWorkdays(st, 2),
      days: 5,
      type: "task",
      number: "10170",
      title: "Оптимизация взаимодействия с vectorNetwork",
    },
  ];
  // демо-данные уже в новой модели: дни рабочих задач — рабочие
  state.tasks.forEach((t) => {
    t.daysMode = "work";
    if (t.type === "vacation" || t.type === "sick") t.weekend = true;
  });
  save();
  render();
  toast("Демо-данные загружены");
}
