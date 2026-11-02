/* ============================================================
   core/plan.js — очередь задач человека.

   Единственное место, где решается, когда начинается задача.
   `task.start` — не источник правды, а снимок: сюда записывается
   вычисленная дата, чтобы доска, старый код и экспорт видели одно
   и то же.

   Порядок в очереди — порядок задач человека в state.tasks.
   Отпуск и больничный на своих датах, в очередь не встают, но
   занимают дни: задача их «перепрыгивает».
   ============================================================ */
import { addDays, diffDays } from "./dates.js";
import { round } from "./util.js";
import { isAbsence, layoutFrom } from "./schedule.js";

const EPS = 1e-9;

/* дни отсутствия человека (отпуск, больничный) в пределах релиза */
function absenceDates(absences, release) {
  const absent = new Set();
  absences.forEach((task) => {
    let left = round(task.days || 0);
    let day = task.start || release.start;
    let guard = 0;
    while (left > EPS && guard++ < 2000) {
      if (diffDays(release.start, day) >= 0) absent.add(day);
      left = round(left - Math.min(1, left));
      day = addDays(day, 1);
    }
  });
  return absent;
}

/* Раскладка одного человека в одном релизе.
   Возвращает:
     cards  — всё, что рисуется на доске: задачи очереди и отпуска;
     absent — Set дат отсутствия (для штриховки и подсчёта загрузки);
     queue  — только задачи очереди в порядке следования. */
export function planPerson(personId, release, tasks) {
  const own = tasks.filter(
    (task) => task.personId === personId && task.releaseId === release.id,
  );
  const absences = own.filter(isAbsence);
  const absent = absenceDates(absences, release);

  // отпуск и больничный стоят там, где стоят, и очередь не двигают.
  // Свои собственные дни в «отсутствие» не подмешиваем, иначе карточка
  // отпуска не получила бы ни одного дня.
  const cards = absences.map((task) => {
    const segs = layoutFrom(
      { ...task, weekend: true },
      task.start || release.start,
      0,
      release.start,
      null,
    ).segs;
    return { task, start: task.start || release.start, segs };
  });

  // очередь: порядок задач в state.tasks, без сортировки по датам.
  // Дробный курсор: половина дня остаётся половиной, следующая задача
  // начинается в тот же день.
  let cursor = release.start;
  let used = 0;
  own
    .filter((task) => !isAbsence(task))
    .forEach((task) => {
      const step = layoutFrom(task, cursor, used, release.start, absent);
      const start = step.segs.length
        ? addDays(release.start, step.segs[0].i)
        : cursor;
      cards.push({ task, start, segs: step.segs });
      cursor = step.day;
      used = step.used;
    });

  return { cards, absent, queue: cards.filter((c) => !isAbsence(c.task)) };
}

/* Пересчитать очередь по всем людям и всем релизам и записать даты
   в task.start. Возвращает true, если что-то изменилось: тогда
   вызывающий код сохраняет данные. */
export function repackAll(releases, tasks) {
  let changed = false;
  releases.forEach((release) => {
    const personIds = new Set();
    tasks.forEach((task) => {
      if (task.releaseId === release.id) personIds.add(task.personId);
    });
    personIds.forEach((personId) => {
      planPerson(personId, release, tasks).queue.forEach(({ task, start }) => {
        if (task.start !== start) {
          task.start = start;
          changed = true;
        }
      });
    });
  });
  return changed;
}

/* сколько дней задачи вылезает за конец релиза */
export function overflowDays(segs, release) {
  const dayCount = diffDays(release.start, release.end) + 1;
  return round(
    segs.reduce((sum, seg) => (seg.i >= dayCount ? sum + seg.amount : sum), 0),
  );
}

/* последний день задачи — для подписи «займёт до ДД.ММ» */
export function lastDay(segs, release) {
  const last = segs[segs.length - 1];
  return last ? addDays(release.start, last.i) : null;
}

/* Предпросмотр места задачи в окне: где она встанет и до какого дня
   займёт. Считается тем же planPerson(), поэтому окно и доска не
   расходятся. Правка (в том числе смена исполнителя или типа) сохраняет
   место в массиве, а значит и порядок очереди — ровно так же её
   положит saveTask(). Новая задача встаёт в конец. */
export function previewPlacement(draft, release, tasks) {
  const prev = tasks.find((task) => task.id === draft.id);
  let list;
  if (!prev) list = tasks.concat(draft);
  else if (prev.personId !== draft.personId)
    // сменился исполнитель — как в saveTask(): в конец чужой очереди
    list = tasks.filter((task) => task.id !== draft.id).concat(draft);
  else list = tasks.map((task) => (task.id === draft.id ? draft : task));

  const { cards } = planPerson(draft.personId, release, list);
  const card = cards.find((item) => item.task.id === draft.id);
  const segs = card ? card.segs : [];
  const start = segs.length ? addDays(release.start, segs[0].i) : release.start;
  return { start, until: lastDay(segs, release) || start, segs };
}
