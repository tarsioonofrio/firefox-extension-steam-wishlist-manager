(() => {
  const OPEN_ENDED_MAX_VALUE = Number.MAX_SAFE_INTEGER;

  function renderRangeControls(values) {
    const ratingMin = Number(values?.ratingMin ?? 0);
    const ratingMax = Number(values?.ratingMax ?? 100);
    const reviewsMin = Number(values?.reviewsMin ?? 0);
    const reviewsMax = Number(values?.reviewsMax ?? OPEN_ENDED_MAX_VALUE);
    const discountMin = Number(values?.discountMin ?? 0);
    const discountMax = Number(values?.discountMax ?? 100);
    const priceMin = Number(values?.priceMin ?? 0);
    const priceMax = Number(values?.priceMax ?? OPEN_ENDED_MAX_VALUE);
    const releaseTextEnabled = Boolean(values?.releaseTextEnabled);
    const releaseYearRangeEnabled = Boolean(values?.releaseYearRangeEnabled);
    const releaseYearMin = Number(values?.releaseYearMin ?? 1970);
    const releaseYearMax = Number(values?.releaseYearMax ?? new Date().getUTCFullYear() + 1);
    const releaseYearRangeMinBound = Number(values?.releaseYearRangeMinBound ?? 1970);
    const releaseYearRangeMaxBound = Number(values?.releaseYearRangeMaxBound ?? new Date().getUTCFullYear() + 1);

    const minLabel = document.getElementById("rating-min-label");
    const maxLabel = document.getElementById("rating-max-label");
    const minRange = document.getElementById("rating-min-range");
    const maxRange = document.getElementById("rating-max-range");
    const minInput = document.getElementById("reviews-min-input");
    const maxInput = document.getElementById("reviews-max-input");
    const discountMinLabel = document.getElementById("discount-min-label");
    const discountMaxLabel = document.getElementById("discount-max-label");
    const discountMinRange = document.getElementById("discount-min-range");
    const discountMaxRange = document.getElementById("discount-max-range");
    const priceMinInput = document.getElementById("price-min-input");
    const priceMaxInput = document.getElementById("price-max-input");
    const releaseYearToggle = document.getElementById("release-year-range-enabled");
    const releaseTextToggle = document.getElementById("release-text-enabled");
    const releaseYearPanel = document.getElementById("release-year-range-panel");
    const releaseYearMinLabel = document.getElementById("release-year-min-label");
    const releaseYearMaxLabel = document.getElementById("release-year-max-label");
    const releaseYearMinRange = document.getElementById("release-year-min-range");
    const releaseYearMaxRange = document.getElementById("release-year-max-range");

    if (minLabel) minLabel.textContent = `${ratingMin}%`;
    if (maxLabel) maxLabel.textContent = `${ratingMax}%`;
    if (minRange) minRange.value = String(ratingMin);
    if (maxRange) maxRange.value = String(ratingMax);
    if (minInput) minInput.value = String(reviewsMin);
    if (maxInput) {
      maxInput.value = reviewsMax >= OPEN_ENDED_MAX_VALUE ? "" : String(reviewsMax);
    }
    if (discountMinLabel) discountMinLabel.textContent = `${discountMin}%`;
    if (discountMaxLabel) discountMaxLabel.textContent = `${discountMax}%`;
    if (discountMinRange) discountMinRange.value = String(discountMin);
    if (discountMaxRange) discountMaxRange.value = String(discountMax);
    if (priceMinInput) priceMinInput.value = String(priceMin);
    if (priceMaxInput) {
      priceMaxInput.value = priceMax >= OPEN_ENDED_MAX_VALUE ? "" : String(priceMax);
    }
    if (releaseTextToggle) releaseTextToggle.checked = releaseTextEnabled;
    if (releaseYearToggle) releaseYearToggle.checked = releaseYearRangeEnabled;
    if (releaseYearMinLabel) releaseYearMinLabel.textContent = String(releaseYearMin);
    if (releaseYearMaxLabel) releaseYearMaxLabel.textContent = String(releaseYearMax);
    if (releaseYearMinRange) {
      releaseYearMinRange.min = String(releaseYearRangeMinBound);
      releaseYearMinRange.max = String(releaseYearRangeMaxBound);
      releaseYearMinRange.value = String(releaseYearMin);
      releaseYearMinRange.disabled = !releaseYearRangeEnabled;
    }
    if (releaseYearMaxRange) {
      releaseYearMaxRange.min = String(releaseYearRangeMinBound);
      releaseYearMaxRange.max = String(releaseYearRangeMaxBound);
      releaseYearMaxRange.value = String(releaseYearMax);
      releaseYearMaxRange.disabled = !releaseYearRangeEnabled;
    }
    if (releaseYearPanel) {
      releaseYearPanel.classList.toggle("disabled", !releaseYearRangeEnabled);
    }
  }

  function bindRangeControls(handlers) {
    const h = handlers || {};
    document.getElementById("rating-min-range")?.addEventListener("input", (event) => {
      h.onRatingMinInput?.(event.target.value);
    });
    document.getElementById("rating-max-range")?.addEventListener("input", (event) => {
      h.onRatingMaxInput?.(event.target.value);
    });
    document.getElementById("apply-reviews-btn")?.addEventListener("click", () => {
      const min = document.getElementById("reviews-min-input")?.value;
      const max = document.getElementById("reviews-max-input")?.value;
      h.onApplyReviews?.(min, max);
    });
    document.getElementById("discount-min-range")?.addEventListener("input", (event) => {
      h.onDiscountMinInput?.(event.target.value);
    });
    document.getElementById("discount-max-range")?.addEventListener("input", (event) => {
      h.onDiscountMaxInput?.(event.target.value);
    });
    document.getElementById("apply-price-btn")?.addEventListener("click", () => {
      const min = document.getElementById("price-min-input")?.value;
      const max = document.getElementById("price-max-input")?.value;
      h.onApplyPrice?.(min, max);
    });
    document.getElementById("release-text-enabled")?.addEventListener("change", (event) => {
      h.onReleaseTextToggle?.(Boolean(event.target.checked));
    });
    document.getElementById("release-year-range-enabled")?.addEventListener("change", (event) => {
      h.onReleaseYearRangeToggle?.(Boolean(event.target.checked));
    });
    document.getElementById("release-year-min-range")?.addEventListener("input", (event) => {
      h.onReleaseYearMinInput?.(event.target.value);
    });
    document.getElementById("release-year-max-range")?.addEventListener("input", (event) => {
      h.onReleaseYearMaxInput?.(event.target.value);
    });
  }

  window.SWMCollectionsRangeControls = {
    renderRangeControls,
    bindRangeControls
  };
})();
