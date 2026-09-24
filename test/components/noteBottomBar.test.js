const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// Assertions are class-based, so the untranslated i18n fallback (raw keys) is fine.
async function renderBottomBar(t, props) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-note-bottom-bar-test-",
    mockModules: {
      "/stores/meetingRecordingStore": `
        export const getMicAnalyser = () => null;
        export const useMeetingRecordingStore = { getState: () => ({ currentMicLevel: 0 }) };
      `,
    },
  });
  const mod = await vite.ssrLoadModule("/components/notes/NoteBottomBar.tsx");
  return renderToStaticMarkup(
    createElement(mod.default, {
      isRecording: false,
      onAskSubmit: () => {},
      ...props,
    })
  );
}

test("recording and idle ask capsules stay opaque (no backdrop-filter)", async (t) => {
  for (const isRecording of [false, true]) {
    const html = await renderBottomBar(t, { isRecording });
    assert.ok(!html.includes("backdrop-blur"), `no backdrop-blur (isRecording=${isRecording})`);
    assert.ok(
      !html.includes("backdrop-saturate"),
      `no backdrop-saturate (isRecording=${isRecording})`
    );
    assert.ok(html.includes("bg-card"), `opaque card surface (isRecording=${isRecording})`);
  }
});

test("the ask capsule never transitions its surface between the two states", async (t) => {
  // transition-all would tween background-color for 500ms on every recording start/stop.
  for (const isRecording of [false, true]) {
    const html = await renderBottomBar(t, { isRecording });
    assert.ok(
      html.includes("transition-[max-width,opacity,padding,border-color,box-shadow]"),
      `capsule transition is property-scoped (isRecording=${isRecording})`
    );
  }
});
