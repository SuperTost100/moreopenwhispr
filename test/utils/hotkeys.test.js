const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/hotkeys.ts");

test("formats numdiv as a readable numpad label", async () => {
  const { formatHotkeyLabelForPlatform } = await load();
  assert.equal(formatHotkeyLabelForPlatform("numdiv", "darwin"), "Num /");
  assert.equal(formatHotkeyLabelForPlatform("NUMDIV", "darwin"), "Num /");
});

test("formats numpad tokens in compound hotkeys", async () => {
  const { formatHotkeyLabelForPlatform } = await load();
  assert.equal(formatHotkeyLabelForPlatform("Shift+numdiv", "darwin"), "Shift+Num /");
});

test("formats num5 as a readable numpad label", async () => {
  const { formatHotkeyLabelForPlatform } = await load();
  assert.equal(formatHotkeyLabelForPlatform("num5", "darwin"), "Num 5");
});

test("formats all numpad operator tokens", async () => {
  const { formatHotkeyLabelForPlatform } = await load();
  assert.deepEqual(
    ["numadd", "numsub", "nummult", "numdiv", "numdec"].map((token) =>
      formatHotkeyLabelForPlatform(token, "darwin")
    ),
    ["Num +", "Num -", "Num *", "Num /", "Num ."]
  );
});

test("leaves existing function and modifier labels unchanged", async () => {
  const { formatHotkeyLabelForPlatform } = await load();
  assert.equal(formatHotkeyLabelForPlatform("F8", "darwin"), "F8");
  assert.equal(
    formatHotkeyLabelForPlatform("CommandOrControl+Shift+K", "darwin"),
    "Cmd+Shift+K"
  );
  assert.equal(
    formatHotkeyLabelForPlatform("CommandOrControl+Shift+K", "win32"),
    "Ctrl+Shift+K"
  );
});
