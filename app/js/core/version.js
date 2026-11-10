// Версия исходников. При упаковке релиза версия в архиве берётся из его тега.
export const APP_VERSION = "1.0.0";
export const RELEASES_URL =
  "https://github.com/yalosyash/team-planner/releases/latest";
export const RELEASES_API =
  "https://api.github.com/repos/yalosyash/team-planner/releases/latest";

export function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    if (!match) throw new Error("Некорректная версия");
    return match.slice(1).map(BigInt);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}
