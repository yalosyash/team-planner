/* :hover у select может включаться и при наведении на связанный label.
   События указателя позволяют отличить само поле от его подписи.
   Делегирование также охватывает динамические списки импорта. */
export function initDropdownHover() {
  document.addEventListener("click", (event) => {
    const label = event.target.closest?.("label");
    const control = label?.control;
    if (
      !control?.matches(
        "select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset])",
      )
    )
      return;
    if (event.target === control || control.contains(event.target)) return;
    event.preventDefault();
  });

  for (const [event, hovered] of [
    ["pointerover", true],
    ["pointerout", false],
  ]) {
    document.addEventListener(
      event,
      ({ target, relatedTarget, pointerType }) => {
        if (pointerType === "touch") return;
        const select = target.closest?.("select");
        if (!select || (relatedTarget && select.contains(relatedTarget)))
          return;
        select.classList.toggle("is-pointer-hovered", hovered);
      },
    );
  }
}
