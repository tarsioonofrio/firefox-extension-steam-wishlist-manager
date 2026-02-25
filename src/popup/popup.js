document.getElementById("open-collections")?.addEventListener("click", async () => {
  const url = browser.runtime.getURL("src/pages/collections.html");
  await browser.tabs.create({ url });
  window.close();
});

document.getElementById("open-configurations")?.addEventListener("click", async () => {
  const url = browser.runtime.getURL("src/pages/configurations.html");
  await browser.tabs.create({ url });
  window.close();
});
