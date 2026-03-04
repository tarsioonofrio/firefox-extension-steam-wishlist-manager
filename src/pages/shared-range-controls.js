(() => {
  function bindDualRangePriority(minId, maxId, options = {}) {
    const minEl = document.getElementById(String(minId || ""));
    const maxEl = document.getElementById(String(maxId || ""));
    if (!minEl || !maxEl) {
      return false;
    }
    const hostSelector = String(options?.hostSelector || ".dual-range");
    const host = minEl.closest(hostSelector);

    const minFrontZ = String(options?.minFrontZ || "6");
    const maxBackZ = String(options?.maxBackZ || "5");
    const maxFrontZ = String(options?.maxFrontZ || "6");
    const minBackZ = String(options?.minBackZ || "5");

    const bringMinFront = () => {
      minEl.style.zIndex = minFrontZ;
      maxEl.style.zIndex = maxBackZ;
    };
    const bringMaxFront = () => {
      maxEl.style.zIndex = maxFrontZ;
      minEl.style.zIndex = minBackZ;
    };
    const chooseClosestHandle = (clientX) => {
      if (!host) {
        return;
      }
      const rect = host.getBoundingClientRect();
      if (!(rect.width > 0)) {
        return;
      }
      const minV = Number(minEl.value || 0);
      const maxV = Number(maxEl.value || 0);
      const lo = Number(minEl.min || 0);
      const hi = Number(minEl.max || 100);
      const span = Math.max(1, hi - lo);
      const minX = rect.left + ((minV - lo) / span) * rect.width;
      const maxX = rect.left + ((maxV - lo) / span) * rect.width;
      if (Math.abs(clientX - minX) <= Math.abs(clientX - maxX)) {
        bringMinFront();
      } else {
        bringMaxFront();
      }
    };

    bringMinFront();
    for (const eventName of ["pointerdown", "mousedown", "touchstart", "focus", "input"]) {
      minEl.addEventListener(eventName, bringMinFront);
      maxEl.addEventListener(eventName, bringMaxFront);
    }
    if (host) {
      host.addEventListener("mousemove", (event) => chooseClosestHandle(event.clientX));
      host.addEventListener("pointerdown", (event) => chooseClosestHandle(event.clientX));
    }
    return true;
  }

  function bindDualRangePairs(pairs, options = {}) {
    const list = Array.isArray(pairs) ? pairs : [];
    for (const pair of list) {
      if (!Array.isArray(pair) || pair.length < 2) {
        continue;
      }
      bindDualRangePriority(pair[0], pair[1], options);
    }
  }

  window.SWMSharedRangeControls = {
    bindDualRangePriority,
    bindDualRangePairs
  };
})();

