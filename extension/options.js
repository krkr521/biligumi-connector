(() => {
  "use strict";

  const shortcutNode = document.getElementById("shortcut");
  const updateStatusNode = document.getElementById("update-status");
  const checkUpdateButton = document.getElementById("check-update");
  const openUpdateButton = document.getElementById("open-update");
  let updateSourceId = "github";
  let updateCheckSeq = 0;

  document.addEventListener("DOMContentLoaded", () => {
    loadShortcut();
    checkExtensionUpdate(false);
  });
  checkUpdateButton.addEventListener("click", () => checkExtensionUpdate(true));
  openUpdateButton.addEventListener("click", openExtensionUpdatePage);

  function loadShortcut() {
    if (!chrome.commands || !chrome.commands.getAll) {
      shortcutNode.textContent = "Alt+Shift+Right";
      return;
    }

    chrome.commands.getAll((commands) => {
      const command = Array.isArray(commands)
        ? commands.find((item) => item.name === "skip-oped")
        : null;
      shortcutNode.textContent = command && command.shortcut ? command.shortcut : "未分配";
    });
  }

  function checkExtensionUpdate(force) {
    const checkSeq = ++updateCheckSeq;
    updateStatusNode.classList.remove("available", "error");
    updateStatusNode.textContent = "正在检查插件更新...";
    checkUpdateButton.disabled = true;
    openUpdateButton.disabled = true;
    chrome.runtime.sendMessage({ type: "biligumi-check-extension-update", force: Boolean(force) }, (result) => {
      if (checkSeq !== updateCheckSeq) return;
      checkUpdateButton.disabled = false;
      if (chrome.runtime.lastError || !result || !result.ok || !result.update) {
        updateStatusNode.classList.add("error");
        updateStatusNode.textContent = "暂时无法检查插件更新。";
        openUpdateButton.disabled = false;
        return;
      }
      const update = result.update;
      const sourceSuffix = update.source && update.source.id === "gitcode" ? "（来自 GitCode）" : "";
      updateSourceId = update.source && update.source.id || "github";
      openUpdateButton.disabled = false;
      if (update.status === "available") {
        updateStatusNode.classList.add("available");
        updateStatusNode.textContent = `发现新版本 v${update.remoteVersion}，当前为 v${update.currentVersion}${sourceSuffix}。`;
        openUpdateButton.textContent = "下载新版";
        return;
      }
      if (update.status === "current") {
        updateStatusNode.textContent = `当前 v${update.currentVersion}，已是最新版本${sourceSuffix}。`;
        openUpdateButton.textContent = "打开项目页";
        return;
      }
      updateStatusNode.classList.add("error");
      updateStatusNode.textContent = "暂时无法检查插件更新。";
    });
  }

  function openExtensionUpdatePage() {
    openUpdateButton.disabled = true;
    chrome.runtime.sendMessage({ type: "biligumi-open-extension-update", sourceId: updateSourceId }, (result) => {
      openUpdateButton.disabled = false;
      if (!chrome.runtime.lastError && result && result.ok) return;
      updateStatusNode.classList.add("error");
      updateStatusNode.textContent = "无法打开项目页，请稍后重试。";
    });
  }
})();
