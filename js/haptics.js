// A light tap felt in the hand: Android — navigator.vibrate; iPhone (iOS 18+) has no vibration for
// web pages, but toggling a native switch (<input type="checkbox" switch>) gives the system's own
// haptic tick — an invisible one is toggled during the user's touch. Elsewhere: nothing.
let iosSwitch = null;

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    Object.assign(label.style, { position: "fixed", left: "-100px", top: "0", opacity: "0", pointerEvents: "none" });
    label.setAttribute("aria-hidden", "true");
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
let enabled = true;
try { enabled = localStorage.getItem("kirson-haptics") !== "0"; } catch { /* private mode */ }

// strength: "tick" (buttons, detents) or "done" (a finished save)
export function haptic(kind = "tick") {
  if (!enabled) return;
  try {
    if (navigator.vibrate) navigator.vibrate(kind === "done" ? [12, 60, 18] : 8);
    else if (ios) iosTick();
  } catch { /* not allowed here */ }
}
