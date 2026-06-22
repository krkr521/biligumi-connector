(() => {
  "use strict";

  const shortcutNode = document.getElementById("shortcut");

  document.addEventListener("DOMContentLoaded", loadShortcut);

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
})();
