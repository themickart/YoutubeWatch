// The plugin deliberately never reads or writes the Figma document or storage.
figma.showUI(__html__, {
  width: 480,
  height: 336,
  title: "YoutubeWatch",
  themeColors: true
});

figma.ui.onmessage = function (message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "resize") {
    if (typeof message.width !== "number" || typeof message.height !== "number" || !isFinite(message.width) || !isFinite(message.height)) return;
    figma.ui.resize(Math.max(360, Math.min(1200, Math.round(message.width))), Math.max(222, Math.min(900, Math.round(message.height))));
  }
};
